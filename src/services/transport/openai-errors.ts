import type { FriendlyError } from '../../types/domain.ts';
import { fromThrown, localError } from '../../utils/errors.ts';

/** Translates OpenAI's HTTP responses into this product's error vocabulary. */

interface OpenAIErrorBody {
  error?: { message?: unknown; type?: unknown; code?: unknown };
}

const readMessage = (body: unknown): string => {
  const message = (body as OpenAIErrorBody | null)?.error?.message;
  return typeof message === 'string' ? message : '';
};

const readCode = (body: unknown): string => {
  const code = (body as OpenAIErrorBody | null)?.error?.code;
  return typeof code === 'string' ? code : '';
};

export function mapOpenAIHttpError(status: number, body: unknown, headers?: Headers): FriendlyError {
  const message = readMessage(body);
  const code = readCode(body);

  if (status === 401 || status === 403) return localError('KEY_REJECTED');

  if (status === 429) {
    if (code === 'insufficient_quota' || /quota|billing|credit/i.test(message)) return localError('KEY_QUOTA');
    const retryAfter = Number(headers?.get('retry-after') ?? Number.NaN);
    return {
      ...localError('RATE_LIMITED'),
      retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 20,
    };
  }

  if (status === 404 || (status === 400 && /model/i.test(message))) return localError('MODEL_UNAVAILABLE');
  if (status === 400 || status === 422) return localError('REQUEST_REJECTED');

  if (status >= 500) {
    return {
      code: 'UPSTREAM_UNAVAILABLE',
      message: 'OpenAI is having trouble right now. Try again in a moment.',
      retryable: true,
    };
  }

  return { code: 'UPSTREAM_UNAVAILABLE', message: "We couldn't analyse this video. Try again.", retryable: true };
}

export function mapOpenAIThrown(error: unknown): FriendlyError {
  if (error instanceof DOMException && error.name === 'TimeoutError') return localError('TIMEOUT');
  return fromThrown(error);
}
