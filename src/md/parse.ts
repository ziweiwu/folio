import { marked, type Token } from 'marked';
import type { Tokens } from 'marked';

/**
 * `[[wikilink]]`, `[[target|label]]` and `[[target#heading]]`.
 *
 * Not part of any markdown standard, but it is how Obsidian, Foam and most
 * personal wikis link between notes, and those are exactly the files people
 * read in a terminal. Emitting a plain `link` token means everything
 * downstream — styling, OSC 8, following — treats it like any other link.
 */
/** How far ahead a wikilink hint looks. See `start` below. */
const WIKILINK_HINT = 4096;

const wikilink = {
  name: 'wikilink',
  level: 'inline' as const,
  /* A hint, not an answer. `marked` calls this once per inline token, handing
     it everything left in the document each time, and scanning all of that on
     every call is quadratic in a document with many inline tokens and no
     wikilink in it: `![` repeated is the worst case, because it never contains
     `[[` at all, so every call scanned to the end and found nothing. 40,000 of
     them took 15 s against 40 ms with the extension off, and 160,000 took four
     minutes — during which the parse is one synchronous call, so the viewer is
     already on the alternate screen and cannot answer Ctrl-C (I-7). Bounded,
     the cost per call is a constant.

     A `[[` past the window is not lost. Returning -1 says "no hint", which is
     what this already returned whenever there was no wikilink left; `marked`
     then advances by one inline token and asks again, so the window reaches
     any real wikilink once the remainder is short enough. The slice is free —
     V8 shares the backing string rather than copying it. */
  start: (src: string) => src.slice(0, WIKILINK_HINT).indexOf('[['),
  tokenizer(src: string) {
    const m = /^\[\[([^\]|#]*)(#[^\]|]+)?(?:\|([^\]]+))?\]\]/.exec(src);
    if (!m) return undefined;
    const target = (m[1] ?? '').trim();
    const anchor = m[2] ?? '';
    if (target === '' && anchor === '') return undefined;
    const label = (m[3] ?? `${target}${anchor}`).trim();
    return {
      type: 'link',
      raw: m[0],
      href: `${target}${anchor}`,
      title: null,
      text: label,
      tokens: [{ type: 'text', raw: label, text: label }],
    };
  },
};

marked.use({ gfm: true, breaks: false, extensions: [wikilink] });

export type FrontMatter = ReadonlyArray<readonly [string, string]>;

export type ParsedDoc = {
  frontMatter: FrontMatter | null;
  tokens: Token[];
};

const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * Pull YAML front matter off the top.
 *
 * This is deliberately not a YAML parser: it lifts top-level `key: value`
 * scalars for the metadata header and ignores anything nested. Rendering front
 * matter as the code block marked would otherwise make of it is what most
 * terminal viewers do, and it looks like a mistake at the top of every note.
 */
export function splitFrontMatter(src: string): { frontMatter: FrontMatter | null; body: string } {
  const m = FRONT_MATTER_RE.exec(src);
  if (!m) return { frontMatter: null, body: src };

  const pairs: Array<readonly [string, string]> = [];
  for (const raw of m[1]!.split(/\r?\n/)) {
    if (raw.trim() === '' || raw.startsWith('#')) continue;
    if (/^\s/.test(raw)) continue; // nested block — skip rather than mangle
    const idx = raw.indexOf(':');
    if (idx <= 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw
      .slice(idx + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    pairs.push([key, value] as const);
  }
  return { frontMatter: pairs.length > 0 ? pairs : null, body: src.slice(m[0].length) };
}

export function parseMarkdown(src: string): ParsedDoc {
  // A BOM survives readFile and would otherwise become a stray glyph in the
  // first heading.
  const clean = src.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const { frontMatter, body } = splitFrontMatter(clean);
  return { frontMatter, tokens: marked.lexer(body) };
}

export type { Token, Tokens };
