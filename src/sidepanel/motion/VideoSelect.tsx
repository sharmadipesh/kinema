import type { DetectedVideo } from '../../types/video.ts';
import { formatClock } from '../../utils/time.ts';

/**
 * Which of several videos to inspect.
 *
 * A feed page has a dozen; the first in document order is almost never the one
 * being watched. The list is ordered by an actual active-video score — rendered
 * area, viewport visibility, audible playback, whether the playhead is moving —
 * and the leader is marked only when it clearly leads. A near-tie is presented
 * as a choice, because showing a coin toss as a confident pick is how the wrong
 * video gets analysed without the user realising they had a decision to make.
 */
export function VideoSelect({
  videos,
  selectedId,
  onSelect,
}: {
  videos: DetectedVideo[];
  selectedId: string | null;
  onSelect(videoId: string): void;
}) {
  if (videos.length < 2) return null;

  const likely = videos.find((video) => video.likelyActive);

  return (
    <section aria-label="Choose a video" className="space-y-1.5">
      <p className="text-xs text-ink-muted">
        {videos.length} videos detected
        {likely ? '' : ' — none is clearly the one playing, so pick the right one'}
      </p>

      <ul className="space-y-1">
        {videos.map((video, index) => {
          const selected = video.id === selectedId;
          return (
            <li key={video.id}>
              <button
                type="button"
                onClick={() => onSelect(video.id)}
                aria-pressed={selected}
                className={[
                  'w-full rounded-sm border px-2 py-1.5 text-left transition-colors duration-fast',
                  selected
                    ? 'border-[var(--mi-accent)] bg-[var(--mi-accent-soft)]'
                    : 'border-line bg-surface-raised hover:bg-[var(--mi-hover)]',
                ].join(' ')}
              >
                <span className="flex items-baseline gap-1.5">
                  <span className="text-xs font-medium text-ink">
                    {index + 1}. {video.title ?? 'Video'}
                  </span>
                  {video.likelyActive ? (
                    <span className="shrink-0 rounded-xs bg-[var(--mi-accent-soft)] px-1 py-px text-2xs text-accent">
                      Likely current
                    </span>
                  ) : null}
                </span>

                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-ink-subtle">
                  {video.duration > 0 ? <span className="tabular">{formatClock(video.duration)}</span> : null}
                  {video.width > 0 ? (
                    <span>{video.height > video.width ? 'Vertical' : video.width === video.height ? 'Square' : 'Landscape'}</span>
                  ) : null}
                  <span>{video.paused ? 'Paused' : 'Playing'}</span>
                  {!video.visible ? <span>Off screen</span> : null}
                  {video.drmProtected ? <span className="text-caution">Protected</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
