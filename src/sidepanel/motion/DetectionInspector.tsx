import { DEBUG } from '../../config.ts';
import type { DetectionReport } from '../../types/messages.ts';
import type { DetectedVideo } from '../../types/video.ts';
import { formatClock } from '../../utils/time.ts';

/**
 * Development-only view of what detection currently believes.
 *
 * `DEBUG` is a build-time constant, so this component and everything it reads
 * are dead code in a production bundle and removed entirely.
 *
 * It exists because detection failures are almost impossible to reason about
 * from the outside: "the wrong video was analysed" could be a stale registry
 * entry, a source swap that went unnoticed, a scoring tie, or an id bound to an
 * element that has left the page — and those look identical in the normal UI.
 * Seeing the ids, the scores and which one the analysis is bound to turns a
 * vague report into a specific one.
 */
export function DetectionInspector({
  report,
  selectedId,
  analysedId,
}: {
  report: DetectionReport | null;
  selectedId: string | null;
  analysedId: string | null;
}) {
  if (!DEBUG) return null;

  return (
    <details className="rounded-md border border-dashed border-line px-2.5 py-2">
      <summary className="cursor-pointer text-2xs font-semibold uppercase tracking-wide text-caution">
        Detection inspector (dev)
      </summary>

      <dl className="mt-2 space-y-1">
        <Row label="Tab" value={report ? String(report.tabId) : 'none'} />
        <Row label="Page" value={report?.pageUrl ?? '—'} />
        <Row label="Site adapter" value={report?.siteLabel ?? '—'} />
        <Row label="Scriptable" value={report ? String(!report.unreachable) : '—'} />
        <Row label="Detected" value={String(report?.videos.length ?? 0)} />
        <Row label="Selected" value={selectedId ?? 'none'} />
        <Row label="Analysis bound to" value={analysedId ?? 'none'} />
      </dl>

      {report?.videos.length ? (
        <ul className="mt-2 space-y-1.5 border-t border-line pt-2">
          {report.videos.map((video) => (
            <li key={video.id}>
              <VideoRow
                video={video}
                selected={video.id === selectedId}
                bound={video.id === analysedId}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </details>
  );
}

function VideoRow({ video, selected, bound }: { video: DetectedVideo; selected: boolean; bound: boolean }) {
  return (
    <div className="rounded-xs bg-surface-sunken px-1.5 py-1">
      <p className="flex items-baseline gap-1.5">
        <span className="font-mono text-2xs text-ink">{video.id}</span>
        {video.likelyActive ? <span className="text-2xs text-accent">likely</span> : null}
        {selected ? <span className="text-2xs text-ink-muted">selected</span> : null}
        {bound ? <span className="text-2xs text-caution">bound</span> : null}
        <span className="tabular ml-auto text-2xs text-ink-subtle">
          score {(video.activeScore ?? 0).toFixed(2)}
        </span>
      </p>
      <p className="mt-0.5 font-mono text-2xs leading-relaxed text-ink-subtle">
        {formatClock(video.duration)} · {video.width}x{video.height} · {video.paused ? 'paused' : 'playing'} ·{' '}
        {video.muted ? 'muted' : 'audible'} · {video.visible ? 'visible' : 'offscreen'} · frames {video.frameAccess}
        {video.frameAccessReason ? ` (${video.frameAccessReason})` : ''} ·{' '}
        {video.streaming ? 'streaming' : 'progressive'}
        {video.drmProtected ? ' · drm' : ''}
      </p>
      <p className="mt-0.5 truncate font-mono text-2xs text-ink-subtle/70">
        {video.currentSrc ?? video.src ?? 'no source'}
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-2xs text-ink-subtle">{label}</dt>
      <dd className="truncate font-mono text-2xs text-ink-muted">{value}</dd>
    </div>
  );
}
