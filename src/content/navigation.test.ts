import { describe, expect, it } from 'vitest';
import { hasNavigated, routeKeyOf } from './navigation.ts';

const at = (href: string) => {
  const url = new URL(href);
  return { pathname: url.pathname, search: url.search, hash: url.hash };
};

describe('routeKeyOf', () => {
  it('treats a new YouTube video as a navigation', () => {
    // The case the previous pathname-only rule missed entirely, and the reason
    // an analysis could describe a video the user had already scrolled past.
    const before = routeKeyOf(at('https://youtube.com/watch?v=AAA'));
    const after = routeKeyOf(at('https://youtube.com/watch?v=BBB'));

    expect(hasNavigated(before, after)).toBe(true);
  });

  it('treats a hash route change as a navigation', () => {
    const before = routeKeyOf(at('https://app.example/#/clip/1'));
    const after = routeKeyOf(at('https://app.example/#/clip/2'));

    expect(hasNavigated(before, after)).toBe(true);
  });

  it('treats a pathname change as a navigation', () => {
    expect(hasNavigated(routeKeyOf(at('https://x.test/a')), routeKeyOf(at('https://x.test/b')))).toBe(true);
  });

  it('does not re-announce when nothing about the route changed', () => {
    // Sites fire history events on scroll and on player state. Re-detecting on
    // every one of them would scan the DOM for no reason.
    const key = routeKeyOf(at('https://youtube.com/watch?v=AAA'));

    expect(hasNavigated(key, routeKeyOf(at('https://youtube.com/watch?v=AAA')))).toBe(false);
  });

  it('ignores the origin, which cannot change without a new document', () => {
    expect(routeKeyOf(at('https://a.test/watch?v=1'))).toBe(routeKeyOf(at('https://b.test/watch?v=1')));
  });
});
