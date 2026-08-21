/**
 * Scheduling helpers. Everything expensive runs off the critical path.
 */

export function debounce<Args extends unknown[]>(run: (...args: Args) => void, delayMs: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (...args: Args): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      run(...args);
    }, delayMs);
  };
  debounced.cancel = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  return debounced;
}

/** Runs at most once per frame, with the most recent argument. */
export function rafThrottle<Args extends unknown[]>(
  run: (...args: Args) => void,
): ((...args: Args) => void) & { cancel: () => void } {
  let frame: number | null = null;
  let latest: Args | null = null;

  const throttled = ((...args: Args) => {
    latest = args;
    if (frame !== null) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      if (latest) run(...latest);
    });
  }) as ((...args: Args) => void) & { cancel: () => void };

  throttled.cancel = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    latest = null;
  };

  return throttled;
}

/** Leading-edge rate limit: fires immediately, then at most once per interval. */
export function rateLimit<Args extends unknown[]>(run: (...args: Args) => void, intervalMs: number) {
  let last = 0;
  return (...args: Args): void => {
    const now = Date.now();
    if (now - last < intervalMs) return;
    last = now;
    run(...args);
  };
}

/** A promise that rejects with a TimeoutError if it does not settle in time. */
export function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new DOMException(`${label} timed out`, 'TimeoutError'));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/** Rejects as soon as the signal aborts. Used to race long operations. */
export function abortable(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Cancelled', 'AbortError'));
      return;
    }
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
  });
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
}
