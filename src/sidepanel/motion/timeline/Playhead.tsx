import { useEffect, useRef } from 'react';
import type { PanelEvent } from '../../../types/messages.ts';

/**
 * The synchronised current-time indicator.
 *
 * It subscribes to time events itself and writes `transform` straight onto its
 * own node, rather than taking `currentTime` as a prop. That is deliberate:
 * lifting the tick into React state would re-render the whole timeline — every
 * marker, every label — four times a second, to move one line three pixels.
 *
 * Positioned in measured pixels rather than a percentage or a container unit,
 * because `transform` is what keeps this on the compositor, and `translateX`
 * resolves a percentage against the *element's own* width (one pixel) rather
 * than the track's.
 */
export function Playhead({
  duration,
  trackWidth,
  videoId,
  subscribe,
  initialTime,
}: {
  duration: number;
  trackWidth: number;
  videoId: string | null;
  subscribe(listener: (event: PanelEvent) => void): () => void;
  initialTime: number;
}) {
  const node = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const place = (time: number): void => {
      const element = node.current;
      if (!element || duration <= 0 || trackWidth <= 0) return;
      const ratio = Math.min(1, Math.max(0, time / duration));
      element.style.transform = `translate3d(${(ratio * trackWidth).toFixed(2)}px, 0, 0)`;
    };

    place(initialTime);
    if (!videoId) return undefined;

    return subscribe((event) => {
      if (event.type !== 'event:time' || event.videoId !== videoId) return;
      place(event.currentTime);
    });
  }, [duration, trackWidth, videoId, subscribe, initialTime]);

  if (!videoId) return null;

  return (
    <div
      ref={node}
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 left-0 w-px bg-accent will-change-transform"
    >
      <span className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] rounded-pill bg-accent" />
    </div>
  );
}
