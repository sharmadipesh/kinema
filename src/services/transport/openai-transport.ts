import { API } from '../../config.ts';
import { readApiKey } from '../../storage/credentials.ts';
import type { FriendlyError } from '../../types/domain.ts';
import type { Candidate, EvidenceFrame } from '../../types/analysis.ts';
import type { MotionEvent, RecreateGuide, RecreatePlatform, VideoMetadata } from '../../types/motion.ts';
import { localError } from '../../utils/errors.ts';
import { log } from '../../utils/logger.ts';
import { hasHostPermission } from '../permissions.ts';
import {
  IMAGE_DETAIL,
  MOTION_EFFORT,
  MOTION_MAX_OUTPUT_TOKENS,
  OPENAI_RESPONSES_ENDPOINT,
  RECREATE_EFFORT,
  RECREATE_MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL,
  type ReasoningEffort,
} from '../model-defaults.ts';
import {
  MOTION_JSON_SCHEMA,
  MOTION_SCHEMA_NAME,
  RECREATE_JSON_SCHEMA,
  RECREATE_SCHEMA_NAME,
} from '../motion-schema.ts';
import {
  MOTION_SYSTEM_PROMPT,
  RECREATE_SYSTEM_PROMPT,
  buildMotionUserPrompt,
  buildRecreatePrompt,
  describeFrame,
} from '../prompts.ts';
import { validateModelAnalysis, validateRecreateGuide, type ModelAnalysis } from '../validate-motion.ts';
import { mapOpenAIHttpError, mapOpenAIThrown } from './openai-errors.ts';
import { extractStructuredText } from './openai-response.ts';

/**
 * Calls OpenAI directly with the user's own key.
 *
 * Runs only in the service worker and extension pages — never in a content
 * script, which is why `storage/credentials.ts` is imported here and nowhere
 * near `src/content/`. The build fails if that ever stops being true.
 *
 * The `openai` npm SDK is deliberately not used: it is a server dependency, and
 * this bundle carries no non-UI dependencies at all.
 */

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: FriendlyError };

type ContentPart =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: string };

interface ResponsesPayload {
  model: string;
  instructions: string;
  input: Array<{ role: 'user'; content: ContentPart[] }>;
  text: { format: { type: 'json_schema'; name: string; schema: object; strict: true } };
  reasoning: { effort: ReasoningEffort };
  max_output_tokens: number;
  /** Analyses are not retained on OpenAI's side. */
  store: false;
}

function payload(
  instructions: string,
  content: ContentPart[],
  schemaName: string,
  schema: object,
  effort: ReasoningEffort,
  maxOutputTokens: number,
): ResponsesPayload {
  return {
    model: DEFAULT_MODEL,
    instructions,
    input: [{ role: 'user', content }],
    text: { format: { type: 'json_schema', name: schemaName, schema, strict: true } },
    reasoning: { effort },
    max_output_tokens: maxOutputTokens,
    store: false,
  };
}

async function post(body: object, key: string, signal?: AbortSignal): Promise<ApiResult<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException('Request timed out', 'TimeoutError')),
    API.timeoutMs,
  );
  const abortUpstream = (): void => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abortUpstream, { once: true });

  try {
    const response = await fetch(OPENAI_RESPONSES_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
      credentials: 'omit',
      cache: 'no-store',
    });

    const parsed: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      log.warn('openai rejected request', { status: response.status });
      return { ok: false, error: mapOpenAIHttpError(response.status, parsed, response.headers) };
    }
    return { ok: true, data: parsed };
  } catch (error) {
    return { ok: false, error: mapOpenAIThrown(error) };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortUpstream);
  }
}

/**
 * Both preconditions are checked before any network call.
 *
 * Skipping the permission check would be a real usability bug: without the host
 * permission `fetch` throws a bare `TypeError`, which the generic mapper reports
 * as "check your connection" — sending the user to their router when the fix is
 * one button in Settings.
 */
async function requireReady(): Promise<{ ok: true; key: string } | { ok: false; error: FriendlyError }> {
  const key = await readApiKey();
  if (!key) return { ok: false, error: localError('KEY_MISSING') };
  if (!(await hasHostPermission(OPENAI_RESPONSES_ENDPOINT))) {
    return { ok: false, error: localError('OPENAI_PERMISSION') };
  }
  return { ok: true, key };
}

export interface ConnectionStatus {
  ready: boolean;
  problem?: FriendlyError;
}

/** Cheap and local. Opening Settings must not cost a token or signal anything. */
export async function checkConnection(): Promise<ConnectionStatus> {
  const key = await readApiKey();
  if (!key) return { ready: false, problem: localError('KEY_MISSING') };
  if (!(await hasHostPermission(OPENAI_RESPONSES_ENDPOINT))) {
    return { ready: false, problem: localError('OPENAI_PERMISSION') };
  }
  return { ready: true };
}

/**
 * Proves a key works, for the settings UI.
 *
 * Takes the key as an argument rather than reading storage, because nothing is
 * persisted until it is verified — a typo should never become a stored,
 * silently-broken configuration.
 *
 * Deliberately not `GET /v1/models`: project-scoped restricted keys often lack
 * `api.model.read` and would fail there while working perfectly for real
 * requests. This exercises the exact endpoint the product uses.
 */
export async function verifyApiKey(key: string, signal?: AbortSignal): Promise<ApiResult<true>> {
  const result = await post(
    { model: DEFAULT_MODEL, input: 'ping', max_output_tokens: 16, reasoning: { effort: 'none' }, store: false },
    key,
    signal,
  );
  // Any 2xx proves authorisation. The 16-token cap makes `incomplete` the normal
  // outcome; we are not reading the content.
  return result.ok ? { ok: true, data: true } : { ok: false, error: result.error };
}

export interface MotionRequest {
  video: VideoMetadata;
  candidates: Candidate[];
  frames: EvidenceFrame[];
  sourceLabel: string;
  signal?: AbortSignal;
}

export async function analyzeMotion(request: MotionRequest): Promise<ApiResult<ModelAnalysis>> {
  const ready = await requireReady();
  if (!ready.ok) return { ok: false, error: ready.error };

  const content: ContentPart[] = [
    {
      type: 'input_text',
      text: buildMotionUserPrompt({
        video: request.video,
        candidates: request.candidates,
        sourceLabel: request.sourceLabel,
      }),
    },
  ];

  // Each image is preceded by a text label, so the model can attribute a frame
  // to a candidate. Without it, twenty-seven unlabelled images are a soup.
  for (const frame of request.frames) {
    content.push({ type: 'input_text', text: describeFrame(frame) });
    content.push({ type: 'input_image', image_url: frame.dataUrl, detail: IMAGE_DETAIL });
  }

  const body = payload(
    MOTION_SYSTEM_PROMPT,
    content,
    MOTION_SCHEMA_NAME,
    MOTION_JSON_SCHEMA,
    MOTION_EFFORT,
    MOTION_MAX_OUTPUT_TOKENS,
  );

  const first = await readAnalysis(await post(body, ready.key, request.signal));
  if (first.ok || !first.repairable) return first.result;

  // Exactly one repair turn, matching the reference project. An unbounded
  // repair loop is an unbounded bill.
  log.warn('motion analysis failed validation, repairing once');
  const repair: ContentPart[] = [
    ...content,
    {
      type: 'input_text',
      text: 'Your previous reply did not match the required schema. Reply again with valid JSON only, using only the candidate ids listed above.',
    },
  ];
  const second = await post(
    payload(MOTION_SYSTEM_PROMPT, repair, MOTION_SCHEMA_NAME, MOTION_JSON_SCHEMA, MOTION_EFFORT, MOTION_MAX_OUTPUT_TOKENS),
    ready.key,
    request.signal,
  );
  return (await readAnalysis(second)).result;
}

export async function generateRecreateGuide(input: {
  event: MotionEvent;
  platform: RecreatePlatform;
  video: VideoMetadata;
  signal?: AbortSignal;
}): Promise<ApiResult<RecreateGuide>> {
  const ready = await requireReady();
  if (!ready.ok) return { ok: false, error: ready.error };

  const body = payload(
    RECREATE_SYSTEM_PROMPT,
    [{ type: 'input_text', text: buildRecreatePrompt(input.event, input.platform, input.video) }],
    RECREATE_SCHEMA_NAME,
    RECREATE_JSON_SCHEMA,
    RECREATE_EFFORT,
    RECREATE_MAX_OUTPUT_TOKENS,
  );

  const response = await post(body, ready.key, input.signal);
  if (!response.ok) return { ok: false, error: response.error };

  const extracted = extractStructuredText(response.data as never);
  if (!extracted.ok) return { ok: false, error: extracted.error };

  const validated = validateRecreateGuide(safeParse(extracted.text), input.platform);
  if (!validated.ok) {
    log.warn('recreate guide failed validation', { issue: validated.issue });
    return { ok: false, error: localError('RESPONSE_INVALID') };
  }
  return { ok: true, data: validated.value };
}

interface AnalysisRead {
  ok: boolean;
  repairable: boolean;
  result: ApiResult<ModelAnalysis>;
}

async function readAnalysis(response: ApiResult<unknown>): Promise<AnalysisRead> {
  if (!response.ok) return { ok: false, repairable: false, result: response };

  const extracted = extractStructuredText(response.data as never);
  if (!extracted.ok) return { ok: false, repairable: false, result: { ok: false, error: extracted.error } };

  const validated = validateModelAnalysis(safeParse(extracted.text));
  if (!validated.ok) {
    log.warn('motion analysis failed validation', { issue: validated.issue });
    return { ok: false, repairable: true, result: { ok: false, error: localError('RESPONSE_INVALID') } };
  }
  return { ok: true, repairable: false, result: { ok: true, data: validated.value } };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
