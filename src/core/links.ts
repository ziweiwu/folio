/**
 * Deciding what a link means, without touching the filesystem.
 *
 * Kept pure so the rules are testable on their own; the caller does the actual
 * resolving, because only it knows where the current document lives.
 */

export type Link =
  /** `#somewhere` — a heading in the document already open. */
  | { kind: 'anchor'; anchor: string }
  /** A path relative to the current document, with an optional heading. */
  | { kind: 'file'; path: string; anchor: string | null }
  /** Anything with a scheme. Shown, never opened: spawning a browser from a
   *  pager is a surprise, and OSC 8 already makes these clickable. */
  | { kind: 'external'; href: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function classifyLink(href: string): Link | null {
  const trimmed = href.trim();
  if (trimmed === '') return null;
  if (trimmed.startsWith('#')) return { kind: 'anchor', anchor: decodeURIComponent(trimmed.slice(1)) };
  // `//example.com` is protocol-relative, and just as external as `https:`.
  if (SCHEME.test(trimmed) || trimmed.startsWith('//')) return { kind: 'external', href: trimmed };

  const hash = trimmed.indexOf('#');
  const path = hash === -1 ? trimmed : trimmed.slice(0, hash);
  const anchor = hash === -1 ? null : decodeURIComponent(trimmed.slice(hash + 1));
  if (path === '') return anchor === null ? null : { kind: 'anchor', anchor };
  return { kind: 'file', path: decodeURIComponent(path), anchor };
}

/**
 * GitHub's heading slug: lowercase, punctuation dropped, spaces hyphenated.
 *
 * Matching is done on the slug rather than the text so `#why-another-one`
 * finds "Why another one?" — which is the form every markdown file in the wild
 * links to.
 */
export function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    /* One hyphen per space, not one per run: GitHub does it this way, so
       "Setup & Config" is linked to as `#setup--config` in the wild. Collapsing
       runs here would fail to match exactly those links. */
    .replace(/\s/g, '-');
}

/** The row a `#anchor` should scroll to, or -1. Falls back to a loose match so
 *  a hand-written anchor that is close enough still lands somewhere useful. */
export function findAnchor(toc: ReadonlyArray<{ text: string; line: number }>, anchor: string): number {
  const want = slugify(anchor);
  const exact = toc.find((e) => slugify(e.text) === want);
  if (exact) return exact.line;
  const loose = toc.find((e) => slugify(e.text).startsWith(want) || want.startsWith(slugify(e.text)));
  return loose ? loose.line : -1;
}
