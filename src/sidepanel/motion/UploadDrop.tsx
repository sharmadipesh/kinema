import { useCallback, useEffect, useRef, useState } from 'react';
import { UPLOAD } from '../../config.ts';
import { UploadIcon } from '../../components/Icons.tsx';
import { Button } from '../../components/ui/Button.tsx';
import { ErrorState } from '../../components/ErrorState.tsx';
import type { FriendlyError } from '../../types/domain.ts';
import type { UploadedVideo } from '../../types/video.ts';
import { localError } from '../../utils/errors.ts';
import { createId } from '../../utils/id.ts';
import { formatClock } from '../../utils/time.ts';

/**
 * Choosing a video file.
 *
 * Support is decided by asking the browser to decode it, never by looking at
 * the extension: `.mov` is H.264 in a QuickTime container roughly as often as
 * it is something Chrome will not touch, and the filename cannot tell you
 * which. So the file is loaded, metadata is read, and the answer comes from
 * whether that worked.
 *
 * The read happens off the interaction: the card shows a loading row rather
 * than the panel freezing, because a large file's metadata can take a moment.
 */
export function UploadDrop({
  upload,
  busy,
  onReady,
  onAnalyze,
  onClear,
}: {
  upload: UploadedVideo | null;
  busy: boolean;
  onReady(video: UploadedVideo): void;
  onAnalyze(): void;
  onClear(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<FriendlyError | null>(null);
  const objectUrl = useRef<string | null>(null);

  // The object URL outlives this component's render but not the panel; a
  // replaced file's URL is revoked the moment it stops being the current one.
  useEffect(
    () => () => {
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    },
    [],
  );

  const accept = useCallback(
    async (file: File): Promise<void> => {
      setError(null);

      if (file.size > UPLOAD.maxBytes) {
        setError(localError('FILE_TOO_LARGE'));
        return;
      }

      setReading(true);
      const url = URL.createObjectURL(file);

      try {
        const metadata = await readMetadata(url);
        if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
        objectUrl.current = url;

        onReady({
          id: createId('upload'),
          name: file.name,
          sizeBytes: file.size,
          mimeType: file.type || 'video/*',
          duration: metadata.duration,
          width: metadata.width,
          height: metadata.height,
          objectUrl: url,
        });
      } catch (caught) {
        URL.revokeObjectURL(url);
        setError(caught as FriendlyError);
      } finally {
        setReading(false);
      }
    },
    [onReady],
  );

  if (upload) {
    return (
      <section className="rounded-md border border-line bg-surface-raised p-2.5" aria-label="Uploaded video">
        <p className="text-sm font-medium text-ink">Video ready</p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">{upload.name}</p>
        <p className="tabular mt-0.5 text-2xs text-ink-subtle">
          {formatClock(upload.duration)} · {upload.width} × {upload.height}
        </p>
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button variant="primary" size="sm" onClick={onAnalyze} disabled={busy}>
            Analyse video
          </Button>
          <Button variant="ghost" size="sm" onClick={onClear} disabled={busy}>
            Choose another
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Upload a video">
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer.files[0];
          if (file) void accept(file);
        }}
        className={[
          'rounded-md border border-dashed px-4 py-6 text-center transition-colors duration-fast',
          dragging ? 'border-[var(--mi-accent)] bg-[var(--mi-accent-soft)]' : 'border-line',
        ].join(' ')}
      >
        <div className="mx-auto mb-2 flex h-8 w-8 items-center justify-center rounded-md bg-surface-sunken text-ink-subtle">
          <UploadIcon size={15} />
        </div>
        <p className="text-sm font-medium text-ink">{reading ? 'Reading video…' : 'Drop a video file'}</p>
        <p className="mx-auto mt-1 max-w-[32ch] text-xs leading-relaxed text-ink-muted">
          MP4, WebM, MOV and anything else this browser can decode.
        </p>
        <div className="mt-3 flex justify-center">
          <Button variant="secondary" size="sm" onClick={() => input.current?.click()} disabled={reading}>
            Choose file
          </Button>
        </div>
        <input
          ref={input}
          type="file"
          accept={UPLOAD.accept}
          className="sr-only"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = '';
            if (file) void accept(file);
          }}
        />
      </div>

      {error ? (
        <div className="mt-2">
          <ErrorState error={error} title="Couldn't read that file" onDismiss={() => setError(null)} />
        </div>
      ) : null}
    </section>
  );
}

/** Asks the browser whether it can actually decode this file. */
function readMetadata(url: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;

    const timer = setTimeout(() => {
      cleanup();
      reject(localError('DECODE_FAILED'));
    }, 15_000);

    const onLoaded = (): void => {
      cleanup();
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        reject(localError('DECODE_FAILED'));
        return;
      }
      resolve({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    };
    const onError = (): void => {
      cleanup();
      reject(localError('UNSUPPORTED_FORMAT'));
    };
    function cleanup(): void {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      video.removeAttribute('src');
    }

    video.addEventListener('loadedmetadata', onLoaded, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.src = url;
  });
}
