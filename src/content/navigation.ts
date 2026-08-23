/**
 * What counts as having navigated somewhere else.
 *
 * Its own module because `content/index.ts` runs its bootstrap on import and
 * therefore cannot be unit-tested, and this rule is exactly the kind that looks
 * obviously right and is quietly wrong: comparing pathnames alone missed the
 * single most common case the feature exists for. YouTube moves between videos
 * as `/watch?v=A` → `/watch?v=B`, which leaves the pathname untouched, so the
 * extension went on describing the previous video for as long as the tab stayed
 * open. Hash routing fails the same way.
 */
export interface RouteParts {
  pathname: string;
  search: string;
  hash: string;
}

export function routeKeyOf(location: RouteParts): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/** True when the two locations are different enough to re-detect videos. */
export function hasNavigated(before: string, after: string): boolean {
  return before !== after;
}
