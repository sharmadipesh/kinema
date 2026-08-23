import { CONTEXT } from '../config.ts';
import { accumulatePalette } from '../analysis/metrics.ts';
import { EVIDENCE } from '../analysis/config.ts';
import type { FrameMetrics } from '../types/analysis.ts';
import type { OffscreenRequest, OffscreenResponse } from '../types/messages.ts';
import { isFriendlyError, unknownError } from '../utils/errors.ts';
import { log } from '../utils/logger.ts';
import { serveRpc } from '../utils/port-rpc.ts';
import { OffscreenVideoSource } from './video-source.ts';

/**
 * The offscreen document.
 *
 * It exists for one hard constraint: an MV3 service worker cannot decode video.
 * There is no `HTMLVideoElement` in a worker context, and writing a demuxer to
 * work around that would be a strange thing to ship. A document can decode, so
 * uploaded files are decoded here.
 *
 * The second reason is lifecycle. The side panel is destroyed the moment the
 * user closes it, and an analysis owned by the panel would die with it —
 * minutes of work and a paid model call, lost because someone clicked away.
 * This document outlives the panel.
 *
 * It holds no credential and makes no network request. It decodes, measures,
 * and hands numbers back.
 */

const source = new OffscreenVideoSource();
let currentRun: AbortController | null = null;

// -- Metrics worker ----------------------------------------------------------

const worker = new Worker(new URL('./diff.worker.ts', import.meta.url), { type: 'module' });
let nextJob = 1;

interface Job {
  resolve(metrics: FrameMetrics[]): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
}

const jobs = new Map<number, Job>();

/**
 * A worker job that never comes back used to hang three contexts at once.
 *
 * The job map previously held only a resolver — no rejection path, no timeout,
 * and no `onerror`. A malformed transfer or an out-of-memory kill in the worker
 * left the offscreen document awaiting forever, which left the service worker
 * awaiting forever, which left the panel spinning on a stage that had already
 * died. One silent failure, three stuck contexts, and nothing in the UI to
 * suggest anything was wrong.
 */
const WORKER_TIMEOUT_MS = 90_000;

function settle(id: number, apply: (job: Job) => void): void {
  const job = jobs.get(id);
  if (!job) return;
  jobs.delete(id);
  clearTimeout(job.timer);
  apply(job);
}

function failAllJobs(reason: string): void {
  for (const id of [...jobs.keys()]) settle(id, (job) => job.reject(new Error(reason)));
}

worker.onmessage = (event: MessageEvent<{ id: number; metrics: FrameMetrics[] }>): void => {
  settle(event.data.id, (job) => job.resolve(event.data.metrics));
};

worker.onerror = (event): void => {
  log.error('metrics worker failed', { message: event.message });
  failAllJobs('The frame analyser stopped responding.');
};

worker.onmessageerror = (): void => {
  log.error('metrics worker sent an unreadable message');
  failAllJobs('The frame analyser returned unreadable data.');
};

function measureInWorker(
  frames: Array<{ time: number; rgba: Uint8Array; width: number; height: number }>,
): Promise<FrameMetrics[]> {
  if (frames.length === 0) return Promise.resolve([]);
  const id = nextJob++;
  return new Promise<FrameMetrics[]>((resolve, reject) => {
    const timer = setTimeout(() => {
      settle(id, () => reject(new Error('The frame analyser did not respond in time.')));
    }, WORKER_TIMEOUT_MS);
    jobs.set(id, { resolve, reject, timer });
    const payload = frames.map((frame) => ({
      time: frame.time,
      // Transferred, not copied: the offscreen document gives up ownership of
      // each buffer as it hands it over.
      rgba: frame.rgba.buffer as ArrayBuffer,
      width: frame.width,
      height: frame.height,
    }));
    worker.postMessage({ id, samples: payload }, payload.map((frame) => frame.rgba));
  });
}

// -- Service worker connection ----------------------------------------------

function connect(): void {
  const port = chrome.runtime.connect({ name: 'mi:offscreen' });

  serveRpc<OffscreenRequest, OffscreenResponse>(port, async (request) => {
    switch (request.type) {
      case 'offscreen:load': {
        currentRun?.abort(new DOMException('Superseded', 'AbortError'));
        currentRun = new AbortController();
        const meta = await source.load(request.objectUrl);
        return { for: 'offscreen:load', ...meta };
      }

      case 'offscreen:measure-fps':
        return { for: 'offscreen:measure-fps', fps: await source.measureFps() };

      case 'offscreen:sample': {
        const signal = (currentRun ??= new AbortController()).signal;
        const frames = await source.sample(request.timestamps, request.size, signal);
        const palette = [...accumulatePalette(frames.map((frame) => ({ time: frame.time, rgba: frame.rgba, width: frame.width, height: frame.height })))];
        return { for: 'offscreen:sample', metrics: await measureInWorker(frames), palette };
      }

      case 'offscreen:capture': {
        const signal = (currentRun ??= new AbortController()).signal;
        const frames = await source.capture(request.times, request.maxWidth, EVIDENCE.jpegQuality, signal);
        return { for: 'offscreen:capture', frames };
      }

      case 'offscreen:thumbnail': {
        const signal = (currentRun ??= new AbortController()).signal;
        const frames = await source.capture([{ id: 'thumb', time: request.time }], request.maxWidth, 0.6, signal);
        return { for: 'offscreen:thumbnail', dataUrl: frames[0]?.dataUrl ?? null };
      }

      case 'offscreen:release':
        currentRun?.abort(new DOMException('Released', 'AbortError'));
        currentRun = null;
        source.release();
        return { for: 'offscreen:release' };

      default: {
        const exhaustive: never = request;
        throw new Error(`unhandled offscreen request ${JSON.stringify(exhaustive)}`);
      }
    }
  });

  /**
   * Cancellation arrives out of band, because the request it is cancelling is
   * still awaiting on this same port. A separate one-shot message is the only
   * way for "stop" to overtake "keep going".
   */
  chrome.runtime.onMessage.addListener((message: { type?: string }) => {
    if (message?.type === 'offscreen:abort') {
      currentRun?.abort(new DOMException('Cancelled by user', 'AbortError'));
      currentRun = null;
    }
    return undefined;
  });

  // Traffic on this port is an event, and events keep the service worker from
  // being suspended mid-analysis.
  const heartbeat = setInterval(() => {
    try {
      port.postMessage({ __mi: true, id: 0, kind: 'ping' });
    } catch {
      clearInterval(heartbeat);
    }
  }, CONTEXT.keepAliveMs);

  port.onDisconnect.addListener(() => {
    clearInterval(heartbeat);
    log.debug('offscreen port closed, reconnecting');
    // The service worker was suspended. Reconnect so the next analysis finds us.
    setTimeout(connect, 250);
  });
}

try {
  connect();
  log.info('offscreen document ready');
} catch (error) {
  log.error('offscreen failed to connect', { error: String(isFriendlyError(error) ? error.code : unknownError().code) });
}
