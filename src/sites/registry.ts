import { log } from '../utils/logger.ts';
import { titleFrom, type SiteAdapter } from './types.ts';

/**
 * Adapter resolution, most specific first. Adding a platform means writing one
 * object and adding it to this array — nothing else in the extension knows
 * which site it is running on.
 */

const youtube: SiteAdapter = {
  id: 'youtube',
  label: 'YouTube',
  matches: (url) => /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(url.hostname),
  describe: (video, url) => {
    if (url.pathname.startsWith('/shorts/')) return 'YouTube Short';
    return video.duration && video.duration < 65 ? 'YouTube clip' : titleFrom(url, 'YouTube video');
  },
  /**
   * YouTube swaps the media on the *same* element for an ad break, so the
   * element identity is no guide. The player marks the ad state on an ancestor,
   * which is the only signal available from an isolated world.
   */
  isContentVideo: (video) => !video.closest('.ad-showing, .ad-interrupting'),
};

const instagram: SiteAdapter = {
  id: 'instagram',
  label: 'Instagram',
  matches: (url) => /(^|\.)instagram\.com$/.test(url.hostname),
  describe: (_video, url) => (url.pathname.includes('/reel') ? 'Instagram Reel' : 'Instagram video'),
};

const tiktok: SiteAdapter = {
  id: 'tiktok',
  label: 'TikTok',
  matches: (url) => /(^|\.)tiktok\.com$/.test(url.hostname),
  describe: () => 'TikTok video',
};

const vimeo: SiteAdapter = {
  id: 'vimeo',
  label: 'Vimeo',
  matches: (url) => /(^|\.)vimeo\.com$/.test(url.hostname),
  describe: (_video, url) => titleFrom(url, 'Vimeo video'),
};

const x: SiteAdapter = {
  id: 'x',
  label: 'X',
  matches: (url) => /(^|\.)x\.com$|(^|\.)twitter\.com$/.test(url.hostname),
  describe: () => 'X video',
};

/** Last in the array, so it only runs when nothing more specific matched. */
const generic: SiteAdapter = {
  id: 'generic',
  label: 'This site',
  matches: () => true,
  describe: (_video, url) => titleFrom(url, 'Video'),
};

const ADAPTERS: SiteAdapter[] = [youtube, instagram, tiktok, vimeo, x, generic];

export function resolveAdapter(url: URL = new URL(location.href)): SiteAdapter {
  for (const adapter of ADAPTERS) {
    try {
      if (adapter.matches(url)) return adapter;
    } catch (error) {
      log.warn('adapter match threw, skipping', { adapter: adapter.id, error: String(error) });
    }
  }
  return generic;
}

export { ADAPTERS };
