import { paint, sliceAnsi, stripAnsi, type ColorLevel, type Style } from './ansi.js';
import { displayWidth } from './width.js';
import type { Line } from './types.js';

export type Match = { line: number; start: number; end: number };

/** Uppercase in the query means the user meant it; all-lowercase matches both. */
export function isCaseSensitive(query: string): boolean {
  return /[A-Z]/.test(query);
}

export function findMatches(lines: readonly Line[], query: string): Match[] {
  if (query === '') return [];
  const sensitive = isCaseSensitive(query);
  const needle = sensitive ? query : query.toLowerCase();
  const out: Match[] = [];

  lines.forEach((line, i) => {
    const hay = sensitive ? line.plain : line.plain.toLowerCase();
    let from = 0;
    for (;;) {
      const at = hay.indexOf(needle, from);
      if (at === -1) break;
      out.push({ line: i, start: at, end: at + needle.length });
      from = at + needle.length;
    }
  });
  return out;
}

/** The first match at or after `line`, wrapping around the end. */
export function nextMatch(matches: readonly Match[], line: number, backwards: boolean): number {
  if (matches.length === 0) return -1;
  if (backwards) {
    for (let i = matches.length - 1; i >= 0; i--) if (matches[i]!.line < line) return i;
    return matches.length - 1;
  }
  for (let i = 0; i < matches.length; i++) if (matches[i]!.line > line) return i;
  return 0;
}

/**
 * Re-style the matched ranges of an already-styled row.
 *
 * Match offsets are indices into the plain text, but a terminal row is measured
 * in cells, so each offset is converted through `displayWidth` of the prefix
 * before it. Ranges are applied right to left so earlier ones keep their
 * offsets while later ones are being spliced in.
 */
export type Highlight = {
  /** Index into the row's plain text. */
  start: number;
  end: number;
  style: Style;
  /** True when start/end are already display cells rather than text indices. */
  cells?: boolean;
};

export function highlightRow(
  row: string,
  plain: string,
  ranges: readonly Highlight[],
  width: number,
  level: ColorLevel,
): string {
  if (ranges.length === 0) return row;
  let out = row;
  /* Right to left, so each splice leaves the offsets of the ones still to come
     untouched. */
  const ordered = ranges.toSorted((a, b) => b.start - a.start);

  for (const range of ordered) {
    const from = range.cells ? range.start : displayWidth(plain.slice(0, range.start));
    const to = range.cells ? range.end : displayWidth(plain.slice(0, range.end));
    if (from >= width || to <= from) continue;
    const end = Math.min(to, width);
    const text = stripAnsi(sliceAnsi(out, from, end));
    out = sliceAnsi(out, 0, from) + paint(text, range.style, level) + sliceAnsi(out, end, width);
  }
  return out;
}
