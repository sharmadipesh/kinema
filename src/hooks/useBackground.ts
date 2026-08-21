import { useCallback, useEffect, useRef, useState } from 'react';
import { CONTEXT } from '../config.ts';
import type { FriendlyError } from '../types/domain.ts';
import type { PanelEvent, PanelRequest, PanelResponse } from '../types/messages.ts';
import { isFriendlyError } from '../utils/errors.ts';
import { createRpcClient, type RpcClient } from '../utils/port-rpc.ts';
import { log } from '../utils/logger.ts';

/**
 * The panel's connection to the service worker.
 *
 * Held open for the panel's whole lifetime rather than opened per request:
 * traffic on a port is what keeps an MV3 worker from being suspended during a
 * multi-minute analysis, and it is also the channel stage updates arrive on.
 *
 * A disconnect means the worker was replaced — an extension reload, an update.
 * Reconnecting silently is right here, because the alternative is a panel that
 * looks alive and answers nothing.
 */
export function useBackground() {
  const clientRef = useRef<RpcClient<PanelRequest, PanelResponse, PanelEvent> | null>(null);
  const listeners = useRef(new Set<(event: PanelEvent) => void>());
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    let disposed = false;
    let retry: ReturnType<typeof setTimeout> | null = null;

    const connect = (): void => {
      if (disposed) return;
      const port = chrome.runtime.connect({ name: 'mi:panel' });
      const client = createRpcClient<PanelRequest, PanelResponse, PanelEvent>(port, {
        heartbeatMs: CONTEXT.keepAliveMs,
      });
      clientRef.current = client;

      client.onEvent((event) => {
        for (const listener of listeners.current) listener(event);
      });

      client.onDisconnect(() => {
        clientRef.current = null;
        if (disposed) return;
        log.debug('panel port closed, reconnecting');
        retry = setTimeout(() => {
          connect();
          setGeneration((value) => value + 1);
        }, 150);
      });
    };

    connect();

    return () => {
      disposed = true;
      if (retry) clearTimeout(retry);
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  /**
   * Waits for the port instead of failing on it.
   *
   * An MV3 service worker is suspended whenever Chrome feels like it, and the
   * panel finds out by its port closing. The old behaviour — reject
   * immediately — surfaced an ordinary, expected, sub-second reconnect to the
   * user as a red "Analysis failed. Reconnecting to the extension." That is a
   * scary error message for a thing that fixed itself before they finished
   * reading it.
   *
   * So a request issued while the port is down waits for the reconnect the
   * effect above is already performing, and only gives up if it genuinely does
   * not come back.
   */
  const whenConnected = useCallback(
    (timeoutMs = 4000): Promise<RpcClient<PanelRequest, PanelResponse, PanelEvent>> =>
      new Promise((resolve, reject) => {
        const existing = clientRef.current;
        if (existing?.connected) {
          resolve(existing);
          return;
        }

        const deadline = Date.now() + timeoutMs;
        const poll = setInterval(() => {
          const client = clientRef.current;
          if (client?.connected) {
            clearInterval(poll);
            resolve(client);
            return;
          }
          if (Date.now() >= deadline) {
            clearInterval(poll);
            reject({
              code: 'PORT_CLOSED',
              message: 'Lost the connection to the extension. Reload the panel and try again.',
              retryable: true,
            } satisfies FriendlyError);
          }
        }, 60);
      }),
    [],
  );

  const request = useCallback(
    async <T extends PanelResponse>(payload: PanelRequest): Promise<T> => {
      const client = await whenConnected();
      try {
        return await client.request<T>(payload);
      } catch (error) {
        // The worker may have been suspended between the check and the send.
        // One retry on a closed port, because that race is normal rather than
        // exceptional.
        if (isFriendlyError(error) && error.code === 'PORT_CLOSED') {
          return (await whenConnected()).request<T>(payload);
        }
        throw error;
      }
    },
    [whenConnected],
  );

  const subscribe = useCallback((listener: (event: PanelEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  return { request, subscribe, generation };
}
