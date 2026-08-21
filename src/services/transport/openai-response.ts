import type { FriendlyError } from '../../types/domain.ts';
import { localError } from '../../utils/errors.ts';

/**
 * Reads a Responses API result.
 *
 * Refusals, truncation and empty output are all real outcomes that arrive with
 * a 200 status, so a transport that only checked HTTP codes would hand
 * malformed text to the parser and report a confusing schema error instead of
 * what actually happened.
 */

export interface ResponseLike {
  status?: string;
  output_text?: string;
  incomplete_details?: { reason?: string } | null;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string; refusal?: string }> }>;
}

export type ExtractOutcome = { ok: true; text: string } | { ok: false; error: FriendlyError };

export function extractStructuredText(response: ResponseLike): ExtractOutcome {
  for (const item of response.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === 'refusal' && part.refusal) return { ok: false, error: localError('CONTENT_REFUSED') };
    }
  }

  if (response.status === 'incomplete') {
    const reason = response.incomplete_details?.reason ?? 'unknown';
    return {
      ok: false,
      error: {
        code: 'RESPONSE_INVALID',
        message:
          reason === 'max_output_tokens'
            ? 'That video produced more detail than we allow in one pass. Try the Economy sampling rate in Settings.'
            : "We couldn't read the analysis for this video. Try again.",
        retryable: true,
      },
    };
  }

  const text = (response.output_text ?? collectText(response)).trim();
  if (!text) return { ok: false, error: localError('RESPONSE_INVALID') };
  return { ok: true, text };
}

function collectText(response: ResponseLike): string {
  const chunks: string[] = [];
  for (const item of response.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === 'output_text' && part.text) chunks.push(part.text);
    }
  }
  return chunks.join('');
}
