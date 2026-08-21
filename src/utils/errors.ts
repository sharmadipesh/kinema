import type { FriendlyError } from '../types/domain.ts';

/**
 * Error translation.
 *
 * The UI never shows a status code. Every failure path resolves to a sentence a
 * person can act on, plus a flag saying whether offering Retry makes sense.
 *
 * Two rules specific to this product:
 *   - Never claim DRM unless the element actually reported media keys. Most
 *     unreadable video is unreadable because of canvas tainting, which is a
 *     different problem with a different fix.
 *   - Never say an analysis was cancelled unless the work actually stopped.
 */

const FALLBACK: FriendlyError = {
  code: 'UNKNOWN',
  message: 'Something went wrong while analysing the video.',
  retryable: true,
};

const LOCAL_MESSAGES = {
  OFFLINE: { code: 'OFFLINE', message: "You're offline. Reconnect and try again.", retryable: true },
  NETWORK: {
    code: 'NETWORK',
    message: "We couldn't reach OpenAI. Check your connection and try again.",
    retryable: true,
  },
  TIMEOUT: { code: 'TIMEOUT', message: 'That took longer than expected. Try again.', retryable: true },
  ABORTED: { code: 'ABORTED', message: 'Analysis cancelled.', retryable: true },
  CONTEXT_INVALIDATED: {
    code: 'CONTEXT_INVALIDATED',
    message: 'The extension was just updated. Reload the page to continue.',
    retryable: false,
  },

  // -- Bring-your-own-key states ------------------------------------------
  KEY_MISSING: {
    code: 'KEY_MISSING',
    message: 'Add your OpenAI API key in Settings to analyse videos.',
    retryable: false,
  },
  KEY_REJECTED: {
    code: 'KEY_REJECTED',
    message: 'Unable to authenticate. Check your API key and try again.',
    retryable: false,
  },
  KEY_QUOTA: {
    code: 'KEY_QUOTA',
    message: 'Your OpenAI account is out of credit. Add billing at platform.openai.com, then try again.',
    retryable: false,
  },
  OPENAI_PERMISSION: {
    code: 'OPENAI_PERMISSION',
    message: 'Chrome needs permission to reach OpenAI. Open Settings and press Connect.',
    retryable: false,
  },
  MODEL_UNAVAILABLE: {
    code: 'MODEL_UNAVAILABLE',
    message: "Your OpenAI account can't use this model yet.",
    retryable: false,
  },
  REQUEST_REJECTED: {
    code: 'REQUEST_REJECTED',
    message: 'OpenAI rejected this request. If it keeps happening, update the extension.',
    retryable: false,
  },
  RATE_LIMITED: {
    code: 'RATE_LIMITED',
    message: "You've made several requests quickly. Try again in a moment.",
    retryable: true,
  },
  CONTENT_REFUSED: {
    code: 'CONTENT_REFUSED',
    message: "This video can't be analysed. Try a different one.",
    retryable: false,
  },
  RESPONSE_INVALID: {
    code: 'RESPONSE_INVALID',
    message: "We couldn't read the analysis for this video. Try again.",
    retryable: true,
  },

  // -- Video states --------------------------------------------------------
  NO_VIDEO: {
    code: 'NO_VIDEO',
    message: 'No video is available on this page any more.',
    retryable: false,
  },
  VIDEO_GONE: {
    code: 'VIDEO_GONE',
    message: 'That video is no longer on the page.',
    retryable: false,
  },
  VIDEO_INACCESSIBLE: {
    code: 'VIDEO_INACCESSIBLE',
    message: 'This video cannot be accessed directly. Try uploading the video instead.',
    retryable: false,
  },
  FRAMES_RESTRICTED: {
    code: 'FRAMES_RESTRICTED',
    message: "This video's frames cannot be accessed from the browser. Upload the video manually to analyse it.",
    retryable: false,
  },
  FRAMES_PROTECTED: {
    code: 'FRAMES_PROTECTED',
    message: 'This video is protected media, so its frames cannot be read. Upload a video file to analyse it.',
    retryable: false,
  },
  UNSUPPORTED_FORMAT: {
    code: 'UNSUPPORTED_FORMAT',
    message: 'Unsupported video format. Try MP4, WebM, or another browser-compatible video format.',
    retryable: false,
  },
  FILE_TOO_LARGE: {
    code: 'FILE_TOO_LARGE',
    message: 'That file is too large to analyse in the browser.',
    retryable: false,
  },
  DECODE_FAILED: {
    code: 'DECODE_FAILED',
    message: "This browser couldn't decode that video. Try MP4 or WebM.",
    retryable: false,
  },
  SEEK_FAILED: {
    code: 'SEEK_FAILED',
    message: "The video didn't respond to seeking, so it can't be sampled.",
    retryable: true,
  },
  NO_CANDIDATES: {
    code: 'NO_CANDIDATES',
    message: 'No meaningful visual changes were found in this video.',
    retryable: false,
  },
  TAB_UNREACHABLE: {
    code: 'TAB_UNREACHABLE',
    message: "Motion Inspector can't read this tab. Open a normal web page and try again.",
    retryable: false,
  },
  PAGE_PERMISSION: {
    code: 'PAGE_PERMISSION',
    // Motion Inspector asks for no site access at install time, so reading a
    // tab depends on the `activeTab` grant Chrome issues when the user invokes
    // the extension there. Switching tabs with the panel already open leaves
    // the new tab ungranted, and clicking the toolbar icon is genuinely the fix.
    message:
      'Motion Inspector needs permission for this tab. Click the Motion Inspector toolbar icon on it, then detect again.',
    retryable: true,
  },
} as const satisfies Record<string, FriendlyError>;

export type LocalErrorCode = keyof typeof LOCAL_MESSAGES;

export function localError(code: LocalErrorCode): FriendlyError {
  return { ...LOCAL_MESSAGES[code] };
}

export function fromThrown(error: unknown): FriendlyError {
  if (error instanceof DOMException && error.name === 'AbortError') return localError('ABORTED');
  if (error instanceof DOMException && error.name === 'TimeoutError') return localError('TIMEOUT');
  if (error instanceof Error) {
    if (/extension context invalidated|receiving end does not exist/i.test(error.message)) {
      return localError('CONTEXT_INVALIDATED');
    }
    if (/timed? ?out/i.test(error.message)) return localError('TIMEOUT');
    if (/failed to fetch|network|load failed/i.test(error.message)) {
      return typeof navigator !== 'undefined' && navigator.onLine === false
        ? localError('OFFLINE')
        : localError('NETWORK');
    }
  }
  return { ...FALLBACK };
}

export const unknownError = (): FriendlyError => ({ ...FALLBACK });

export function isFriendlyError(value: unknown): value is FriendlyError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<FriendlyError>;
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}
