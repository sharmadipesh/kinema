import { computeMetrics, type FrameSample } from '../analysis/metrics.ts';
import type { FrameMetrics } from '../types/analysis.ts';

/**
 * Pixel math, off the main thread.
 *
 * The offscreen document has to decode and draw on its own thread — only a
 * document can hold an <video> — but the block-matching search over a hundred
 * frame pairs has no reason to sit there with it. Grayscale buffers arrive as
 * transferables, so nothing is copied.
 *
 * This worker is pure: it imports the same `analysis/metrics.ts` the content
 * script does, so there is exactly one implementation of every measurement in
 * the product, and it can be unit-tested without a browser at all.
 */

interface WorkerRequest {
  id: number;
  samples: Array<{ time: number; rgba: ArrayBuffer; width: number; height: number }>;
}

interface WorkerResponse {
  id: number;
  metrics: FrameMetrics[];
}

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const { id, samples } = event.data;
  const frames: FrameSample[] = samples.map((sample) => ({
    time: sample.time,
    rgba: new Uint8Array(sample.rgba),
    width: sample.width,
    height: sample.height,
  }));
  const response: WorkerResponse = { id, metrics: computeMetrics(frames) };
  (self as unknown as Worker).postMessage(response);
};
