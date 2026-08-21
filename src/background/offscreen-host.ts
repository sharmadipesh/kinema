import { CONTEXT } from '../config.ts';
import type { OffscreenRequest, OffscreenResponse } from '../types/messages.ts';
import { unknownError } from '../utils/errors.ts';
import { log } from '../utils/logger.ts';
import { createRpcClient, type RpcClient } from '../utils/port-rpc.ts';

/**
 * Owns the offscreen document's lifetime and the port to it.
 *
 * Two Chrome constraints shape this: only one offscreen document may exist per
 * extension, and creating a second throws rather than returning the first. So
 * creation is guarded by an actual context query, and serialised behind a
 * single promise so two concurrent analyses cannot race into that error.
 */

let client: RpcClient<OffscreenRequest, OffscreenResponse, never> | null = null;
let creating: Promise<void> | null = null;
let waiters: Array<() => void> = [];

export function registerOffscreenPort(port: chrome.runtime.Port): void {
  client = createRpcClient<OffscreenRequest, OffscreenResponse, never>(port, {
    heartbeatMs: CONTEXT.keepAliveMs,
  });
  client.onDisconnect(() => {
    client = null;
  });
  log.debug('offscreen port registered');

  const pending = waiters;
  waiters = [];
  for (const resolve of pending) resolve();
}

async function exists(): Promise<boolean> {
  // `getContexts` is the only reliable check; the older `clients.matchAll`
  // approach reports a document that is already tearing down.
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
}

export async function ensureOffscreen(): Promise<void> {
  if (client?.connected) return;

  if (!creating) {
    creating = (async () => {
      if (!(await exists())) {
        await chrome.offscreen.createDocument({
          url: CONTEXT.offscreenPath,
          // BLOBS: the uploaded file is handed over as an object URL and read
          // back as decoded frames. WORKERS: the document spawns the metrics
          // worker so the block-matching search stays off its own thread.
          reasons: [chrome.offscreen.Reason.BLOBS, chrome.offscreen.Reason.WORKERS],
          justification:
            'Decodes an uploaded video file and measures its frames. A service worker has no video decoder.',
        });
      }
    })().finally(() => {
      creating = null;
    });
  }
  await creating;

  // The document connects back on load; wait for that rather than assuming it.
  if (!client?.connected) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        waiters = waiters.filter((entry) => entry !== onReady);
        reject(unknownError());
      }, 8000);
      const onReady = (): void => {
        clearTimeout(timer);
        resolve();
      };
      waiters.push(onReady);
    });
  }
}

export async function offscreenRequest<T extends OffscreenResponse>(request: OffscreenRequest): Promise<T> {
  await ensureOffscreen();
  if (!client) throw unknownError();
  return client.request<T>(request);
}

/**
 * Cancellation has to travel out of band: the request it is cancelling is still
 * awaiting a reply on the port, and a queued message behind it would arrive too
 * late to do anything.
 */
export function abortOffscreen(): void {
  void chrome.runtime.sendMessage({ type: 'offscreen:abort' }).catch(() => undefined);
}

export async function closeOffscreen(): Promise<void> {
  try {
    if (await exists()) await chrome.offscreen.closeDocument();
  } catch (error) {
    log.warn('could not close offscreen document', { error: String(error) });
  }
  client = null;
}
