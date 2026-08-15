import { ansiWidth, padAnsi, paint, sliceAnsi, type ColorLevel } from '../core/ansi.js';
import { displayWidth, truncate } from '../core/width.js';
import type { Doc, Theme } from '../core/types.js';

/**
 * The frame around the document: scrollbar, status bar, and the slice of rows
 * in between.
 *
 * These are plain string functions rather than React components on purpose.
 * Composing the frame here means the Ink tree is one Text node per row, which
 * is what keeps a 10,000-line document as cheap to draw as a 30-line one, and
 * it lets the preview script render an honest frame with no terminal at all.
 */

export type ScrollState = {
  offset: number;
  /** Rows of document visible at once. */
  height: number;
  total: number;
  /** Cells the viewport is shifted sideways over wide rows. */
  hOffset?: number;
};

/** Rows of thumb and track for the right-hand gutter, top to bottom. */
export function scrollbar(state: ScrollState, theme: Theme, level: ColorLevel): string[] {
  const { offset, height, total } = state;
  if (total <= height) return Array.from({ length: height }, () => paint(' ', {}, level));

  const size = Math.max(1, Math.round((height * height) / total));
  const span = height - size;
  const maxOffset = total - height;
  const top = maxOffset <= 0 ? 0 : Math.round((span * offset) / maxOffset);

  return Array.from({ length: height }, (_, i) =>
    i >= top && i < top + size
      ? paint('┃', theme.scrollThumb, level)
      : paint('│', theme.scrollTrack, level),
  );
}

export type StatusInfo = {
  /** A transient note. Replaces the whole bar rather than the filename, so it
   *  is never truncated to fit next to everything else. */
  message?: string | null;
  name: string;
  section: string | null;
  /**
   * Live state that outranks the hints — currently the sideways offset.
   *
   * The hints are a legend the reader can get from `?` at any time. This says
   * what the viewport is doing *now*, and it is what tells a reader whether
   * the `›` at the edge of a row is something `l` can reach. Dropping it to
   * make room for the legend gets the priority exactly backwards.
   */
  state?: string | null;
  offset: number;
  height: number;
  total: number;
  /** Right-hand hints; dropped from the end when the bar is too narrow. */
  hints: string;
};

/** Percentage of the document above the fold, as a reader would describe it. */
export function scrollPercent(offset: number, height: number, total: number): number {
  const max = Math.max(0, total - height);
  if (max === 0) return 100;
  return Math.round((offset / max) * 100);
}

export function statusBar(info: StatusInfo, width: number, theme: Theme, level: ColorLevel): string {
  const { status, statusAccent, statusMuted } = theme;

  if (info.message) {
    const text = paint(` ${truncate(info.message, Math.max(0, width - 2))}`, statusAccent, level);
    return padAnsi(text, width, status, level);
  }

  const pct = `${scrollPercent(info.offset, info.height, info.total)}%`.padStart(4);
  const sep = paint('  ·  ', statusMuted, level);

  let left =
    paint(' ', status, level) +
    paint(truncate(info.name, Math.max(8, Math.floor(width / 3))), statusAccent, level) +
    sep +
    paint(pct, status, level);

  if (info.section) {
    const room = width - ansiWidth(left) - ansiWidth(sep) - ansiWidth(info.hints) - 4;
    if (room > 12) left += sep + paint(truncate(info.section, room), statusMuted, level);
  }

  if (info.state) {
    /* Fitted against the bar itself, not against what is left after the hints,
       so the legend is what gives way when the bar is narrow. Narrower still,
       the count goes but the mark stays: *that* the viewport is offset is what
       tells a reader the `›` on a row is something `l` can reach, and it is
       worth more than the number of cells it has moved. */
    const spare = width - ansiWidth(left) - 1;
    const mark = [...info.state][0] ?? '';
    if (spare >= ansiWidth(sep) + displayWidth(info.state)) {
      left += sep + paint(info.state, statusAccent, level);
    } else if (mark !== '' && spare >= ansiWidth(sep) + displayWidth(mark)) {
      left += sep + paint(mark, statusAccent, level);
    }
  }

  // Two cells of daylight, or the legend reads as part of whatever precedes it.
  const room = width - ansiWidth(left) - 1;
  const hints = room >= ansiWidth(info.hints) + 2 ? paint(info.hints, statusMuted, level) : '';
  const bar = padAnsi(left, width - ansiWidth(hints) - 1, status, level) + hints + paint(' ', status, level);
  // The bar is the one row that must be exactly the terminal width — a short
  // one leaves the previous frame's pixels showing through.
  return ansiWidth(bar) > width ? sliceAnsi(bar, 0, width) : padAnsi(bar, width, status, level);
}

/** The heading in effect at the top of the viewport, for sticky context. */
export function sectionAt(doc: Doc, offset: number): string | null {
  let current: string | null = null;
  for (const entry of doc.toc) {
    if (entry.line > offset) break;
    current = `${'#'.repeat(entry.level)} ${entry.text}`;
  }
  return current;
}

/**
 * The visible rows: one document row per line, each padded to `width` and
 * carrying its scrollbar cell.
 *
 * Padding matters. Ink erases a frame by overwriting it, so a row that is
 * shorter than the last frame's row at the same position leaves that row's tail
 * on screen.
 */
export function composeFrame(
  doc: Doc,
  state: ScrollState,
  width: number,
  theme: Theme,
  level: ColorLevel,
  decorate?: (row: string, docLine: number) => string,
): string[] {
  const bar = scrollbar(state, theme, level);
  const body = width - 1;
  const h = state.hOffset ?? 0;
  const rows: string[] = [];

  for (let i = 0; i < state.height; i++) {
    const idx = state.offset + i;
    const line = doc.lines[idx];
    let text = line?.ansi ?? '';
    if (line && decorate) text = decorate(text, idx);

    /* Only rows laid out at their natural width move sideways. Prose is already
       wrapped to fit, so shifting it would push it off screen for nothing. */
    const full = ansiWidth(text);
    const shifted = line?.wide === true && h > 0;
    /* A row the viewport cannot show in full. Both cases are marked with `›`,
       which says only what is true of both: the row continues past this edge.
       Whether `l` can reach the rest is a separate question the status bar
       answers. An ellipsis was tried and is wrong — with colour stripped it is
       byte-identical to one the author typed, so the reader cannot tell the
       document from the viewer, and a mark that only exists in colour is no
       mark at all. Silently cutting a word is the one thing not allowed. */
    let cut = false;
    if (shifted) text = sliceAnsi(text, h, h + body);
    else if (full > body) {
      text = sliceAnsi(text, 0, body);
      cut = line?.wide !== true;
    }

    let row = padAnsi(text, body, {}, level);
    /* Markers cost a cell, so they are only drawn where one can be spared.
       Below that the row is already at the terminal's floor and adding a glyph
       would push the frame past its own width. */
    if (body >= 2) {
      if (line?.wide === true) {
        // Honest edge markers: a row that continues past either edge says so,
        // otherwise there is no way to tell that `l` would reveal anything.
        if (h > 0) row = paint('‹', theme.faint, level) + sliceAnsi(row, 1, body);
        if (full > h + body) row = sliceAnsi(row, 0, body - 1) + paint('›', theme.faint, level);
      } else if (cut) {
        row = sliceAnsi(row, 0, body - 1) + paint('›', theme.faint, level);
      }
    }
    rows.push(row + (bar[i] ?? ' '));
  }
  return rows;
}

/** How far sideways the viewport may go, given the widest row on screen. */
export function maxHOffset(doc: Doc, state: ScrollState, width: number): number {
  let widest = 0;
  for (let i = 0; i < state.height; i++) {
    const line = doc.lines[state.offset + i];
    if (line?.wide === true) widest = Math.max(widest, displayWidth(line.plain));
  }
  return Math.max(0, widest - (width - 1));
}
