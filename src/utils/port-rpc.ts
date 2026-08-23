import type { FriendlyError } from '../types/domain.ts';
import { isFriendlyError, unknownError } from './errors.ts';
import { log } from './logger.ts';

/**
 * Request/response over a `chrome.runtime.Port`.
 *
 * Ports rather than one-shot `sendMessage` for one reason that matters in MV3:
 * an extension service worker is terminated after roughly 30 seconds of
 * inactivity, and a video analysis takes minutes. Traffic on an open port is an
 * event, and events reset that timer — so the panel and the offscreen document
 * each hold a port open for the duration of a run, with a heartbeat covering
 * the quiet stretches (a long model call, a slow seek).
 *
 * A disconnect is not an error to swallow: every pending request rejects
 * immediately rather than hanging forever, which is what makes the panel able
 * to show a real failure instead of a spinner that never resolves.
 */

interface Envelope {
  __mi: true;
  id: number;
  kind: 'req' | 'res' | 'err' | 'evt' | 'ping';
  payload?: unknown;
  error?: FriendlyError;
}

const isEnvelope = (value: unknown): value is Envelope =>
  Boolean(value) && typeof value === 'object' && (value as Envelope).__mi === true;

export interface RpcOptions {
  /**
   * Safety net, not a scheduler.
   *
   * A port request settles on a reply or on disconnect and on nothing else, so
   * a handler that hangs leaves the caller waiting forever while the port stays
   * open and the heartbeat keeps it looking healthy. Generous values here catch
   * a genuine hang without cutting off slow-but-working stages; the progress
   * watchdog handles the user-facing side of "this is taking a while".
   */
  timeoutMs?: number;
}

export interface RpcClient<Req, Res, Evt> {
  request<T extends Res>(payload: Req, options?: RpcOptions): Promise<T>;
  onEvent(listener: (event: Evt) => void): () => void;
  onDisconnect(listener: () => void): () => void;
  disconnect(): void;
  readonly connected: boolean;
}

export function createRpcClient<Req, Res, Evt>(
  port: chrome.runtime.Port,
  options: { heartbeatMs?: number } = {},
): RpcClient<Req, Res, Evt> {
  let nextId = 1;
  let connected = true;
  const pending = new Map<
    number,
    { resolve(value: never): void; reject(error: FriendlyError): void; timer: ReturnType<typeof setTimeout> | null }
  >();
  const eventListeners = new Set<(event: Evt) => void>();
  const disconnectListeners = new Set<() => void>();

  const heartbeat = options.heartbeatMs
    ? setInterval(() => {
        if (!connected) return;
        try {
          port.postMessage({ __mi: true, id: 0, kind: 'ping' } satisfies Envelope);
        } catch {
          /* the disconnect handler will clean up */
        }
      }, options.heartbeatMs)
    : null;

  port.onMessage.addListener((raw: unknown) => {
    if (!isEnvelope(raw)) return;
    if (raw.kind === 'evt') {
      for (const listener of eventListeners) listener(raw.payload as Evt);
      return;
    }
    const entry = pending.get(raw.id);
    if (!entry) return;
    pending.delete(raw.id);
    if (entry.timer) clearTimeout(entry.timer);
    if (raw.kind === 'err') entry.reject(raw.error ?? unknownError());
    else entry.resolve(raw.payload as never);
  });

  port.onDisconnect.addListener(() => {
    connected = false;
    if (heartbeat) clearInterval(heartbeat);
    const error: FriendlyError = {
      code: 'PORT_CLOSED',
      message: 'The extension background stopped responding. Try again.',
      retryable: true,
    };
    for (const [, entry] of pending) {
      if (entry.timer) clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
    for (const listener of disconnectListeners) listener();
  });

  return {
    get connected() {
      return connected;
    },
    request<T extends Res>(payload: Req, options: RpcOptions = {}): Promise<T> {
      if (!connected) {
        return Promise.reject({
          code: 'PORT_CLOSED',
          message: 'The extension background stopped responding. Try again.',
          retryable: true,
        } satisfies FriendlyError);
      }
      const id = nextId++;
      return new Promise<T>((resolve, reject) => {
        const timer = options.timeoutMs
          ? setTimeout(() => {
              pending.delete(id);
              log.warn('port request timed out', { timeoutMs: options.timeoutMs });
              reject({
                code: 'STAGE_TIMEOUT',
                message: 'That step stopped responding. Your completed analysis is preserved.',
                retryable: true,
              } satisfies FriendlyError);
            }, options.timeoutMs)
          : null;

        pending.set(id, { resolve: resolve as (value: never) => void, reject, timer });
        try {
          port.postMessage({ __mi: true, id, kind: 'req', payload } satisfies Envelope);
        } catch (error) {
          pending.delete(id);
          if (timer) clearTimeout(timer);
          log.warn('port send failed', { error: String(error) });
          reject(unknownError());
        }
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    onDisconnect(listener) {
      disconnectListeners.add(listener);
      return () => disconnectListeners.delete(listener);
    },
    disconnect() {
      if (heartbeat) clearInterval(heartbeat);
      port.disconnect();
    },
  };
}

/**
 * The other end. A handler that throws produces an `err` envelope, so a bug in
 * one request can never take down the port or leave the caller hanging.
 */
export function serveRpc<Req, Res>(
  port: chrome.runtime.Port,
  handle: (request: Req) => Promise<Res>,
): { emit(event: unknown): void } {
  port.onMessage.addListener((raw: unknown) => {
    if (!isEnvelope(raw) || raw.kind !== 'req') return;
    void handle(raw.payload as Req)
      .then((payload) => {
        port.postMessage({ __mi: true, id: raw.id, kind: 'res', payload } satisfies Envelope);
      })
      .catch((error: unknown) => {
        const friendly = isFriendlyError(error) ? error : unknownError();
        log.warn('rpc handler failed', { error: String(error) });
        try {
          port.postMessage({ __mi: true, id: raw.id, kind: 'err', error: friendly } satisfies Envelope);
        } catch {
          /* port already gone */
        }
      });
  });

  return {
    emit(event: unknown) {
      try {
        port.postMessage({ __mi: true, id: 0, kind: 'evt', payload: event } satisfies Envelope);
      } catch {
        /* port already gone; the disconnect listener cleans up */
      }
    },
  };
}
