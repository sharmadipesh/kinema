import type { DetectedVideo } from '../../types/video.ts';
import { formatClock } from '../../utils/time.ts';

/**
 * Which of several videos to inspect.
 *
 * A feed page has a dozen; the first in document order is almost never the one
 * being watched. The list is ordered by what the user is most likely looking at
 * (playing and on screen wins), but the choice stays theirs, and the chosen id
 * is what every later message carries.
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

  return (
    <div className="flex items-center gap-2">
      <label htmlFor="mi-video-select" className="shrink-0 text-xs text-ink-muted">
        {videos.length} videos detected
      </label>
      <select
        id="mi-video-select"
        value={selectedId ?? ''}
        onChange={(event) => onSelect(event.currentTarget.value)}
        className="min-w-0 flex-1 rounded-sm border border-line bg-surface-raised px-1.5 py-1 text-xs text-ink focus:border-line-strong focus:outline-none"
      >
        {videos.map((video, index) => (
          <option key={video.id} value={video.id}>
            {index + 1}. {video.title ?? 'Video'}
            {video.duration > 0 ? ` (${formatClock(video.duration)})` : ''}
            {video.paused ? '' : ' · playing'}
          </option>
        ))}
      </select>
    </div>
  );
}
