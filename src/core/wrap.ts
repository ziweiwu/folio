import { clusters, displayWidth } from './width.js';
import { hyperlink, paint, type ColorLevel } from './ansi.js';
import type { Span } from './types.js';

/** Break spans into words and whitespace runs, keeping each atom's styling. */
function atomize(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const span of spans) {
    // Split on whitespace but keep it, so wrapping can drop it at a line break
    // and preserve it in the middle of a line.
    for (const piece of span.text.split(/(\s+)/)) {
      if (piece === '') continue;
      out.push({ ...span, text: piece });
    }
  }
  return out;
}

function hardSplit(atom: Span, width: number): Span[] {
  const parts: Span[] = [];
  let cur = '';
  let w = 0;
  for (const [ch, cw] of clusters(atom.text)) {
    if (w + cw > width && cur !== '') {
      parts.push({ ...atom, text: cur });
      cur = '';
      w = 0;
    }
    cur += ch;
    w += cw;
  }
  if (cur !== '') parts.push({ ...atom, text: cur });
  return parts;
}

/**
 * Greedy word wrap over styled spans.
 *
 * Words longer than the line (URLs, mostly) are hard-split rather than allowed
 * to overflow, because overflowing corrupts the frame — see I-1.
 */
export function wrapSpans(spans: Span[], width: number): Span[][] {
  if (width <= 0) return [spans];
  const atoms = atomize(spans);
  const lines: Span[][] = [];
  let line: Span[] = [];
  let w = 0;

  const flush = () => {
    // Trailing whitespace would count against the width budget of a line that
    // has already been broken, so it goes.
    while (line.length > 0 && /^\s+$/.test(line[line.length - 1]!.text)) line.pop();
    lines.push(line);
    line = [];
    w = 0;
  };

  for (const atom of atoms) {
    if (/^\s+$/.test(atom.text)) {
      if (line.length === 0) continue; // no leading space on a wrapped line
      /* Every run of whitespace becomes exactly one space. Source line breaks
         inside a paragraph are not breaks in the rendered document, and
         carrying them through would re-impose the author's 80-column wrapping
         on top of ours. */
      if (w + 1 > width) continue;
      line.push({ ...atom, text: ' ' });
      w += 1;
      continue;
    }

    const aw = displayWidth(atom.text);
    if (aw > width) {
      if (line.length > 0) flush();
      const parts = hardSplit(atom, width);
      for (let i = 0; i < parts.length; i++) {
        line = [parts[i]!];
        w = displayWidth(parts[i]!.text);
        if (i < parts.length - 1) flush();
      }
      continue;
    }

    if (w + aw > width && line.length > 0) flush();
    line.push(atom);
    w += aw;
  }
  flush();

  // A single empty input yields one empty line, not zero — a blank paragraph
  // still occupies a row.
  return lines.length === 0 ? [[]] : lines;
}

/** Merge adjacent spans that share styling, so the output carries fewer escapes. */
function coalesce(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of spans) {
    const prev = out[out.length - 1];
    if (prev && prev.link === s.link && sameStyle(prev.style, s.style)) {
      out[out.length - 1] = { ...prev, text: prev.text + s.text };
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

function sameStyle(a: Span['style'], b: Span['style']): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    !!a.bold === !!b.bold &&
    !!a.dim === !!b.dim &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline &&
    !!a.strike === !!b.strike &&
    !!a.inverse === !!b.inverse
  );
}

/** `hyperlinks` false keeps the href on the span but omits the OSC 8 escape,
 *  for terminals told to show link targets some other way. */
export function renderSpans(spans: Span[], level: ColorLevel, hyperlinks = true): string {
  let out = '';
  for (const s of coalesce(spans)) {
    const painted = paint(s.text, s.style, level);
    out += hyperlinks && s.link ? hyperlink(painted, s.link, level) : painted;
  }
  return out;
}

/** Where each link sits on a row, measured in display cells. */
export function linkRanges(spans: Span[]): Array<{ href: string; start: number; end: number }> {
  const out: Array<{ href: string; start: number; end: number }> = [];
  let col = 0;
  for (const s of spans) {
    const w = displayWidth(s.text);
    const prev = out[out.length - 1];
    // Adjacent spans of one link (bold inside the label, say) are one target.
    if (s.link && prev && prev.href === s.link && prev.end === col) prev.end = col + w;
    else if (s.link) out.push({ href: s.link, start: col, end: col + w });
    col += w;
  }
  return out;
}

export function plainSpans(spans: Span[]): string {
  return spans.map((s) => s.text).join('');
}

export function spansWidth(spans: Span[]): number {
  return displayWidth(plainSpans(spans));
}

/**
 * Split on width alone, preserving every character.
 *
 * Code needs this rather than `wrapSpans`: leading indentation is meaningful,
 * and word-wrapping a line of source at a space is worse than continuing it.
 */
export function chopSpans(spans: Span[], width: number): Span[][] {
  if (width <= 0) return [spans];
  const lines: Span[][] = [];
  let line: Span[] = [];
  let w = 0;
  for (const span of spans) {
    let cur = '';
    for (const [ch, cw] of clusters(span.text)) {
      if (w + cw > width) {
        if (cur !== '') line.push({ ...span, text: cur });
        lines.push(line);
        line = [];
        cur = '';
        w = 0;
      }
      cur += ch;
      w += cw;
    }
    if (cur !== '') line.push({ ...span, text: cur });
  }
  lines.push(line);
  return lines;
}

/** Cut styled spans to `width` cells, marking the cut with an ellipsis. */
export function truncateSpans(spans: Span[], width: number): Span[] {
  if (width <= 0) return [];
  if (spansWidth(spans) <= width) return spans;
  const out: Span[] = [];
  let w = 0;
  for (const span of spans) {
    let cur = '';
    for (const [ch, cw] of clusters(span.text)) {
      if (w + cw > width - 1) {
        if (cur !== '') out.push({ ...span, text: cur });
        out.push({ ...span, text: '…' });
        return out;
      }
      cur += ch;
      w += cw;
    }
    if (cur !== '') out.push({ ...span, text: cur });
  }
  return out;
}

/** Pad styled spans to exactly `width` cells with `fill`. */
export function padSpans(spans: Span[], width: number, fill: Span['style']): Span[] {
  const w = spansWidth(spans);
  if (w >= width) return spans;
  return [...spans, { text: ' '.repeat(width - w), style: fill }];
}
