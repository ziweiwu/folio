import { ansiWidth, padAnsi, paint, sliceAnsi, type ColorLevel, type Style } from '../core/ansi.js';
import { displayWidth, padEnd, truncate } from '../core/width.js';
import type { Doc, Theme } from '../core/types.js';

/** Rounded frame, matching the code blocks in the document itself. */
const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' } as const;

/**
 * One cell of overlay background all the way around the box.
 *
 * Without it the pane's own border can land immediately beside a box-drawing
 * glyph from the document underneath — a code fence, a table edge — and the two
 * borders read as one fused rule. The margin is what makes the pane look like
 * it is *over* the page rather than spliced into it.
 */
const MARGIN = 1;

/** Below this there is no room for a box with anything inside it. */
const MIN_BOX = 8;

/** Absolute floor: four cells still draw `╭╮` over `╰╯` without throwing. */
const HARD_MIN = 4;

export type Pane = { rows: string[]; width: number; height: number };

function frame(
  title: string,
  body: readonly string[],
  width: number,
  maxHeight: number,
  theme: Theme,
  level: ColorLevel,
): Pane {
  const bg: Style = { bg: theme.overlayBg };
  const border: Style = { ...theme.tableBorder, bg: theme.overlayBg };

  /* Every width below is clamped rather than trusted. A pane is centred on a
     terminal that can be any size, and `String.repeat` throws on a negative
     count — which is how a narrow terminal used to take the whole app down. */
  const margin = width >= MIN_BOX + MARGIN * 2 ? MARGIN : 0;
  const box = Math.max(HARD_MIN, width - margin * 2);
  const inner = Math.max(0, box - 4);
  const outer = box + margin * 2;

  /* The title has to leave room for `╭─`, one closing `─` and `╮`, or the head
     row comes out wider than every other row and the box shears. */
  const label = ` ${truncate(title, Math.max(0, box - 5))} `;
  const head =
    paint(BOX.tl + BOX.h, border, level) +
    paint(label, theme.overlayTitle, level) +
    paint(BOX.h.repeat(Math.max(0, box - 3 - ansiWidth(label))) + BOX.tr, border, level);

  const blank = paint(' '.repeat(outer), bg, level);
  const gutter = margin > 0 ? paint(' '.repeat(margin), bg, level) : '';
  const wrap = (row: string) => gutter + row + gutter;

  /* The blank rows above and below are the same courtesy as the side margins,
     and the first thing to give up: on a short terminal a pane that fits
     matters more than one that is nicely inset. */
  const vMargin = body.length + 4 <= maxHeight;
  const rows = vMargin ? [blank, wrap(head)] : [wrap(head)];
  for (const line of body) {
    /* Clamped, not merely padded: `padAnsi` pads a short row but leaves a long
       one alone, so an over-wide entry would print straight through the right
       border and out over the document. */
    const fitted = ansiWidth(line) > inner ? sliceAnsi(line, 0, inner) : line;
    rows.push(
      wrap(
        paint(BOX.v + ' ', border, level) +
          padAnsi(fitted, inner, bg, level) +
          paint(' ' + BOX.v, border, level),
      ),
    );
  }
  rows.push(wrap(paint(BOX.bl + BOX.h.repeat(Math.max(0, box - 2)) + BOX.br, border, level)));
  if (vMargin) rows.push(blank);
  return { rows, width: outer, height: rows.length };
}

export function tocPane(
  doc: Doc,
  selected: number,
  width: number,
  height: number,
  theme: Theme,
  level: ColorLevel,
): Pane {
  const paneWidth = Math.min(Math.max(36, Math.floor(width * 0.6)), Math.max(MIN_BOX, width - 2));
  const inner = Math.max(1, paneWidth - MARGIN * 2 - 4);
  const maxRows = Math.max(1, Math.min(doc.toc.length, height - 5));

  // Keep the selection in view without letting the list jump around it.
  const start = Math.max(0, Math.min(selected - Math.floor(maxRows / 2), doc.toc.length - maxRows));
  const body: string[] = [];

  if (doc.toc.length === 0) {
    body.push(paint(truncate('This document has no headings.', inner), { ...theme.faint, bg: theme.overlayBg }, level));
  }

  for (let i = start; i < Math.min(start + maxRows, doc.toc.length); i++) {
    const entry = doc.toc[i]!;
    const indent = '  '.repeat(Math.max(0, entry.level - 1));
    const text = truncate(`${indent}${entry.text}`, Math.max(0, inner - 2));
    const style: Style =
      i === selected
        ? { ...theme.overlayText, bg: theme.overlayBg, bold: true, fg: theme.overlayTitle.fg }
        : entry.level <= 2
          ? { ...theme.overlayText, bg: theme.overlayBg }
          : { ...theme.faint, bg: theme.overlayBg };
    body.push(
      paint(i === selected ? '▸ ' : '  ', { ...style, bold: true }, level) + paint(text, style, level),
    );
  }

  if (doc.toc.length > maxRows) {
    body.push(
      paint(
        truncate(`  ${start + 1}–${Math.min(start + maxRows, doc.toc.length)} of ${doc.toc.length}`, inner),
        { ...theme.faint, bg: theme.overlayBg },
        level,
      ),
    );
  }

  return frame('Contents', body, paneWidth, height, theme, level);
}

/** Every key the viewer answers to, in the order the reader meets them. */
const KEYS: ReadonlyArray<readonly [string, string]> = [
  ['j  k  ↓  ↑', 'one line'],
  ['d  u', 'half a screen'],
  ['f  b  space', 'a full screen'],
  ['g  G', 'top, bottom'],
  ['h  l  ←  →', 'sideways, over wide code'],
  ['0', 'back to the left'],
  ['wheel', 'three lines'],
  ['', ''],
  ['/', 'search this document'],
  ['n  N', 'next, previous match'],
  ['t', 'contents'],
  ['', ''],
  ['tab  ⇧tab', 'pick a link'],
  ['enter', 'follow it'],
  ['backspace', 'go back'],
  ['y', 'copy the code block on screen'],
  ['r', 'reload from disk'],
  ['?', 'this list'],
  ['q  esc', 'quit'],
];

export function helpPane(width: number, height: number, theme: Theme, level: ColorLevel): Pane {
  /* Measured in display cells, not code units: I-2 applies to the chrome as
     much as to the document. */
  const keyWidth = Math.max(...KEYS.map(([k]) => displayWidth(k)));
  const widest = Math.max(...KEYS.map(([k, what]) => (k === '' ? 0 : 2 + keyWidth + 3 + displayWidth(what))));
  const paneWidth = Math.min(widest + 4 + MARGIN * 2, Math.max(MIN_BOX, width - 2));
  const inner = Math.max(1, paneWidth - MARGIN * 2 - 4);
  const bg: Style = { bg: theme.overlayBg };

  /* The frame, the margins and the status bar all cost rows; what is left is
     what the list may use. Clipped rather than dropped silently — see below. */
  const room = Math.max(1, height - 2);
  let shown = KEYS;
  // Blank spacers are the first thing to go: they group the list, but a group
  // the reader cannot see is worth less than a key they can.
  if (shown.length > room) shown = shown.filter(([key]) => key !== '');
  const clipped = shown.length > room;
  // The "cut" note costs a row of its own, and only earns it if one is spare.
  const note = clipped && room >= 2;
  if (clipped) {
    /* Quit is pinned. Everything else in this list is a convenience; `q` is the
       way out, and a reader who cannot find it is stuck in a full-screen app. */
    const quit = shown[shown.length - 1]!;
    shown = [...shown.slice(0, Math.max(0, room - (note ? 2 : 1))), quit];
  }

  const body = shown.map(([key, what]) =>
    key === ''
      ? paint('', bg, level)
      : paint('  ' + padEnd(key, keyWidth), { ...theme.overlayTitle, bold: false }, level) +
        paint(truncate('   ' + what, Math.max(0, inner - 2 - keyWidth)), { ...theme.overlayText, bg: theme.overlayBg }, level),
  );

  // Never let the list end without saying it was cut — a reader who cannot see
  // `q` has no way to know the list continues.
  if (note) {
    body.push(paint(truncate('  …  folio --help lists them all', inner), { ...theme.faint, bg: theme.overlayBg }, level));
  }

  return frame('Keys', body, paneWidth, height, theme, level);
}

/** The search prompt, which replaces the status bar while typing. */
export function searchBar(
  query: string,
  matches: number,
  active: boolean,
  width: number,
  theme: Theme,
  level: ColorLevel,
): string {
  const { status, statusAccent, statusMuted } = theme;
  const count =
    query === '' ? '' : matches === 0 ? '  no matches' : `  ${matches} match${matches === 1 ? '' : 'es'}`;
  const left =
    paint(' /', statusAccent, level) +
    paint(query, status, level) +
    paint(active ? '▏' : ' ', statusAccent, level) +
    paint(count, statusMuted, level);
  const bar = padAnsi(left, width, status, level);
  // The bar owns exactly one row of exactly the terminal's width; a long query
  // must not push it wider and wrap onto the document.
  return ansiWidth(bar) > width ? sliceAnsi(bar, 0, width) : bar;
}
