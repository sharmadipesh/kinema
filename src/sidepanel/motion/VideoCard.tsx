import { FilmIcon } from '../../components/Icons.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { Chip } from '../../components/ui/Chip.tsx';
import type { DetectedVideo } from '../../types/video.ts';
import { formatClock } from '../../utils/time.ts';

/**
 * The video Motion Inspector is pointed at.
 *
 * The card's job beyond identification is to be straight about two things
 * before the user spends a model call: whether the frames can be read at all,
 * and that analysing a page video will visibly scrub it. Both are stated here,
 * not discovered afterwards.
 */
export function VideoCard({
  video,
  currentTime,
  busy,
  onAnalyze,
  onUploadInstead,
}: {
  video: DetectedVideo;
  currentTime: number;
  busy: boolean;
  onAnalyze(): void;
  onUploadInstead(): void;
}) {
  const restricted = video.frameAccess === 'restricted';
  const reason = video.frameAccessReason;

  return (
    <section className="overflow-hidden rounded-md border border-line bg-surface-raised" aria-label="Current video">
      <div className="relative aspect-video w-full bg-surface-sunken">
        {video.poster ? (
          <img src={video.poster} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" />
        ) : (
          <div className="flex h-full items-center justify-center text-ink-subtle">
            <FilmIcon size={20} />
          </div>
        )}
        <span className="tabular absolute bottom-1.5 right-1.5 rounded-xs bg-black/65 px-1.5 py-0.5 text-2xs text-white">
          {formatClock(currentTime)} / {formatClock(video.duration)}
        </span>
      </div>

      <div className="p-2.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink">{video.title ?? 'Video'}</p>
            <p className="mt-0.5 text-2xs text-ink-subtle">
              {video.siteLabel}
              {video.width > 0 ? ` · ${video.width} × ${video.height}` : ''}
            </p>
          </div>
          {video.drmProtected ? (
            <Chip tone="caution">Protected</Chip>
          ) : restricted ? (
            <Chip tone="caution">Frames locked</Chip>
          ) : video.frameAccess === 'available' ? (
            <Chip tone="accent">Readable</Chip>
          ) : null}
        </div>

        {restricted ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            {reason === 'protected'
              ? "This video is protected media, so its frames cannot be read. Upload a video file to analyse it."
              : "This video's frames cannot be accessed from the browser. Upload the video manually to analyse it."}
          </p>
        ) : (
          <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
            Analysing steps through the video, so you will see it scrub. It is returned to where you left it.
          </p>
        )}

        <div className="mt-2.5 flex items-center gap-1.5">
          {restricted ? (
            <Button variant="primary" size="sm" onClick={onUploadInstead}>
              Upload video instead
            </Button>
          ) : (
            <>
              <Button variant="primary" size="sm" onClick={onAnalyze} disabled={busy || video.duration <= 0}>
                Analyse video
              </Button>
              <Button variant="ghost" size="sm" onClick={onUploadInstead}>
                Upload instead
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
