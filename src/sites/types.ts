/**
 * Site adapters keep every site-specific assumption in one place.
 *
 * These sites will change their DOM. When they do, the damage must be contained
 * to one small file here — nothing outside `src/sites/` may reference a
 * platform's class name, test id or URL shape.
 *
 * Note what an adapter is *not* allowed to do: it cannot declare that a video's
 * frames are readable. That is decided by an actual runtime probe, per element,
 * every time. A hostname is not evidence.
 */
export interface SiteAdapter {
  readonly id: string;
  readonly label: string;
  matches(url: URL): boolean;
  /** Human-readable name for one video, shown on the Current Video card. */
  describe(video: HTMLVideoElement, url: URL): string;
  /**
   * Site-specific exclusion. Return false for ad breaks, bumpers and preview
   * loops that are not the content the user is looking at.
   */
  isContentVideo?(video: HTMLVideoElement): boolean;
}

export const titleFrom = (url: URL, fallback: string): string => {
  const title = document.title?.trim();
  if (title) return title.replace(/\s*[|·—-]\s*(YouTube|Vimeo|Instagram|TikTok|X)\s*$/i, '').slice(0, 80);
  return `${fallback} · ${url.hostname}`;
};
