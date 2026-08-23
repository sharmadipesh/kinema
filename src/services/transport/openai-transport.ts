import { API } from '../../config.ts';
import { readApiKey } from '../../storage/credentials.ts';
import type { FriendlyError } from '../../types/domain.ts';
import type {
  EditRhythm,
  MotionAnalysis,
  PaletteSwatch,
  ProductionBlueprint,
  StoryStage,
  MotionEvent,
  MotionProfile,
  RecreateGuide,
  RecreatePlatform,
  Scene,
  VideoMetadata,
} from '../../types/motion.ts';
import { localError } from '../../utils/errors.ts';
import { log } from '../../utils/logger.ts';
import { hasHostPermission } from '../permissions.ts';
import {
  BLUEPRINT_EFFORT,
  BLUEPRINT_MAX_OUTPUT_TOKENS,
  EVENTS_EFFORT,
  EVENTS_MAX_OUTPUT_TOKENS,
  GLOBAL_EFFORT,
  GLOBAL_MAX_OUTPUT_TOKENS,
  IMAGE_DETAIL,
  RECONCILE_EFFORT,
  RECONCILE_MAX_OUTPUT_TOKENS,
  OPENAI_RESPONSES_ENDPOINT,
  RECREATE_EFFORT,
  RECREATE_MAX_OUTPUT_TOKENS,
  DEFAULT_MODEL,
  type ReasoningEffort,
} from '../model-defaults.ts';
import { BLUEPRINT_JSON_SCHEMA, BLUEPRINT_SCHEMA_NAME } from '../blueprint-schema.ts';
import { BLUEPRINT_SYSTEM_PROMPT, buildBlueprintPrompt } from '../blueprint-prompts.ts';
import { validateBlueprint, type BlueprintContext } from '../validate-blueprint.ts';
import {
  EVENTS_JSON_SCHEMA,
  EVENTS_SCHEMA_NAME,
  GLOBAL_JSON_SCHEMA,
  GLOBAL_SCHEMA_NAME,
  RECONCILE_JSON_SCHEMA,
  RECONCILE_SCHEMA_NAME,
  RECREATE_JSON_SCHEMA,
  RECREATE_SCHEMA_NAME,
} from '../motion-schema.ts';
import {
  EVENTS_SYSTEM_PROMPT,
  GLOBAL_SYSTEM_PROMPT,
  RECONCILE_SYSTEM_PROMPT,
  RECREATE_SYSTEM_PROMPT,
  buildEventsPrompt,
  buildGlobalPrompt,
  buildReconcilePrompt,
  buildRecreatePrompt,
  describeFrame,
  type PromptEvent,
} from '../prompts.ts';
import {
  validateGlobalContext,
  validateModelEvents,
  validateReconciliation,
  validateRecreateGuide,
  type GlobalContext,
  type ModelEvent,
  type Reconciliation,
} from '../validate-motion.ts';
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

// -- Pass 1: global context ---------------------------------------------------

export interface GlobalRequest {
  video: VideoMetadata;
  scenes: Scene[];
  rhythm?: EditRhythm;
  profile: MotionProfile;
  sourceLabel: string;
  frames: Array<{ time: number; dataUrl: string }>;
  signal?: AbortSignal;
}

/**
 * Establishes the editing language before any individual moment is judged.
 *
 * Cheap — a handful of thumbnails and text — and it changes the quality of
 * every later call: an event seen in isolation is a shot change, while the same
 * event seen as one of six identically built direction-matched transitions is a
 * deliberate device. The candidate pass receives this summary as context.
 */
export async function analyzeGlobalContext(request: GlobalRequest): Promise<ApiResult<GlobalContext>> {
  const ready = await requireReady();
  if (!ready.ok) return { ok: false, error: ready.error };

  const content: ContentPart[] = [
    {
      type: 'input_text',
      text: buildGlobalPrompt({
        video: request.video,
        scenes: request.scenes,
        ...(request.rhythm ? { rhythm: request.rhythm } : {}),
        profile: request.profile,
        sourceLabel: request.sourceLabel,
        frameTimes: request.frames.map((frame) => frame.time),
      }),
    },
  ];
  for (const frame of request.frames) {
    content.push({ type: 'input_image', image_url: frame.dataUrl, detail: IMAGE_DETAIL });
  }

  const response = await post(
    payload(GLOBAL_SYSTEM_PROMPT, content, GLOBAL_SCHEMA_NAME, GLOBAL_JSON_SCHEMA, GLOBAL_EFFORT, GLOBAL_MAX_OUTPUT_TOKENS),
    ready.key,
    request.signal,
  );
  if (!response.ok) return { ok: false, error: response.error };

  const extracted = extractStructuredText(response.data as never);
  if (!extracted.ok) return { ok: false, error: extracted.error };

  const validated = validateGlobalContext(safeParse(extracted.text));
  if (!validated.ok) {
    log.warn('global context failed validation', { issue: validated.issue });
    return { ok: false, error: localError('RESPONSE_INVALID') };
  }
  return { ok: true, data: validated.value };
}

// -- Pass 2: candidate interpretation -----------------------------------------

export interface EventsRequest {
  entries: PromptEvent[];
  globalSummary: string | null;
  signal?: AbortSignal;
}

/**
 * Interprets one batch of events.
 *
 * Batched rather than sent whole, because a single call carrying every event
 * and every frame has to attribute dozens of images to dozens of moments before
 * it can say anything about any of them — and depth per event is exactly what
 * gets sacrificed when attention is spread that thin. Four events per call
 * keeps each one's filmstrip legible as a sequence.
 */
export async function analyzeEvents(request: EventsRequest): Promise<ApiResult<ModelEvent[]>> {
  const ready = await requireReady();
  if (!ready.ok) return { ok: false, error: ready.error };

  const content: ContentPart[] = [
    { type: 'input_text', text: buildEventsPrompt(request.entries, request.globalSummary) },
  ];

  for (const entry of request.entries) {
    const anchor = entry.candidate.peakTime ?? entry.candidate.time;
    for (const frame of [...entry.frames].sort((a, b) => a.order - b.order)) {
      content.push({ type: 'input_text', text: describeFrame(frame, Math.round((frame.time - anchor) * 1000)) });
      content.push({ type: 'input_image', image_url: frame.dataUrl, detail: IMAGE_DETAIL });
    }
  }

  const body = payload(
    EVENTS_SYSTEM_PROMPT, content, EVENTS_SCHEMA_NAME, EVENTS_JSON_SCHEMA, EVENTS_EFFORT, EVENTS_MAX_OUTPUT_TOKENS,
  );

  const first = await readEvents(await post(body, ready.key, request.signal));
  if (first.ok || !first.repairable) return first.result;

  // Exactly one repair turn. An unbounded repair loop is an unbounded bill.
  log.warn('event batch failed validation, repairing once');
  const repair: ContentPart[] = [
    ...content,
    {
      type: 'input_text',
      text: 'Your previous reply did not match the required schema. Reply again with valid JSON only, using only the event ids listed above.',
    },
  ];
  const second = await post(
    payload(EVENTS_SYSTEM_PROMPT, repair, EVENTS_SCHEMA_NAME, EVENTS_JSON_SCHEMA, EVENTS_EFFORT, EVENTS_MAX_OUTPUT_TOKENS),
    ready.key,
    request.signal,
  );
  return (await readEvents(second)).result;
}

// -- Pass 3: reconciliation ---------------------------------------------------

export interface ReconcileRequest {
  video: VideoMetadata;
  events: MotionEvent[];
  scenes: Scene[];
  rhythm?: EditRhythm;
  profile: MotionProfile;
  globalSummary: string | null;
  signal?: AbortSignal;
}

/**
 * The whole-picture pass. Text only, so it costs almost nothing.
 */
export async function reconcileAnalysis(request: ReconcileRequest): Promise<ApiResult<Reconciliation>> {
  const ready = await requireReady();
  if (!ready.ok) return { ok: false, error: ready.error };

  const content: ContentPart[] = [
    {
      type: 'input_text',
      text: buildReconcilePrompt({
        video: request.video,
        events: request.events,
        scenes: request.scenes,
        ...(request.rhythm ? { rhythm: request.rhythm } : {}),
        profile: request.profile,
        globalSummary: request.globalSummary,
      }),
    },
  ];

  const response = await post(
    payload(
      RECONCILE_SYSTEM_PROMPT, content, RECONCILE_SCHEMA_NAME, RECONCILE_JSON_SCHEMA,
      RECONCILE_EFFORT, RECONCILE_MAX_OUTPUT_TOKENS,
    ),
    ready.key,
    request.signal,
  );
  if (!response.ok) return { ok: false, error: response.error };

  const extracted = extractStructuredText(response.data as never);
  if (!extracted.ok) return { ok: false, error: extracted.error };

  const validated = validateReconciliation(safeParse(extracted.text));
  if (!validated.ok) {
    log.warn('reconciliation failed validation', { issue: validated.issue });
    return { ok: false, error: localError('RESPONSE_INVALID') };
  }
  return { ok: true, data: validated.value };
}

export interface BlueprintRequest {
  video: VideoMetadata;
  analysis: Pick<MotionAnalysis, 'overview' | 'events' | 'editingDNA'>;
  scenes: Scene[];
  rhythm?: EditRhythm;
  profile: MotionProfile;
  stages: StoryStage[];
  palette: PaletteSwatch[];
  derivedToolkit: BlueprintContext['derivedToolkit'];
  globalSummary: string | null;
  sourceLabel: string;
  frames: Array<{ time: number; dataUrl: string }>;
  signal?: AbortSignal;
}

/**
 * The production blueprint: one call covering camera, gear, lighting, colour,
 * story prose and editor judgement.
 *
 * One rather than ten, because all of it derives from the same reading of the
 * same video — ten calls would pay ten times for ten independent guesses that
 * then contradict each other. Everything measurable is supplied to it rather
 * than asked of it.
 */
export async function generateBlueprint(request: BlueprintRequest): Promise<ApiResult<ProductionBlueprint>> {
  const ready = await requireReady();
  if (!ready.ok) return { ok: false, error: ready.error };

  const content: ContentPart[] = [
    {
      type: 'input_text',
      text: buildBlueprintPrompt({
        video: request.video,
        analysis: request.analysis,
        scenes: request.scenes,
        ...(request.rhythm ? { rhythm: request.rhythm } : {}),
        profile: request.profile,
        stages: request.stages,
        palette: request.palette,
        globalSummary: request.globalSummary,
        sourceLabel: request.sourceLabel,
        frameTimes: request.frames.map((frame) => frame.time),
      }),
    },
  ];
  for (const frame of request.frames) {
    content.push({ type: 'input_image', image_url: frame.dataUrl, detail: IMAGE_DETAIL });
  }

  const response = await post(
    payload(
      BLUEPRINT_SYSTEM_PROMPT, content, BLUEPRINT_SCHEMA_NAME, BLUEPRINT_JSON_SCHEMA,
      BLUEPRINT_EFFORT, BLUEPRINT_MAX_OUTPUT_TOKENS,
    ),
    ready.key,
    request.signal,
  );
  if (!response.ok) return { ok: false, error: response.error };

  const extracted = extractStructuredText(response.data as never);
  if (!extracted.ok) return { ok: false, error: extracted.error };

  const validated = validateBlueprint(safeParse(extracted.text), {
    stages: request.stages,
    palette: request.palette,
    derivedToolkit: request.derivedToolkit,
  });
  if (!validated.ok) {
    log.warn('blueprint failed validation', { issue: validated.issue });
    return { ok: false, error: localError('RESPONSE_INVALID') };
  }
  return { ok: true, data: validated.value };
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

interface EventsRead {
  ok: boolean;
  repairable: boolean;
  result: ApiResult<ModelEvent[]>;
}

async function readEvents(response: ApiResult<unknown>): Promise<EventsRead> {
  if (!response.ok) return { ok: false, repairable: false, result: response };

  const extracted = extractStructuredText(response.data as never);
  if (!extracted.ok) return { ok: false, repairable: false, result: { ok: false, error: extracted.error } };

  const validated = validateModelEvents(safeParse(extracted.text));
  if (!validated.ok) {
    log.warn('event batch failed validation', { issue: validated.issue });
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
