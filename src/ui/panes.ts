import { ansiWidth, padAnsi, paint, type ColorLevel, type Style } from '../core/ansi.js';
import { truncate } from '../core/width.js';
import type { Doc, Theme } from '../core/types.js';

/** Rounded frame, matching the code blocks in the document itself. */
const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' } as const;

export type Pane = { rows: string[]; width: number; height: number };

function frame(
  title: string,
  body: readonly string[],
  width: number,
  theme: Theme,
  level: ColorLevel,
): Pane {
  const bg: Style = { bg: theme.overlayBg };
  const border: Style = { ...theme.tableBorder, bg: theme.overlayBg };
  const inner = width - 4;

  const label = ` ${truncate(title, Math.max(0, inner - 4))} `;
  const head =
    paint(BOX.tl + BOX.h, border, level) +
    paint(label, theme.overlayTitle, level) +
    paint(BOX.h.repeat(Math.max(0, width - 3 - ansiWidth(label))) + BOX.tr, border, level);

  const rows = [head];
  for (const line of body) {
    rows.push(
      paint(BOX.v + ' ', border, level) +
        padAnsi(line, inner, bg, level) +
        paint(' ' + BOX.v, border, level),
    );
  }
  rows.push(paint(BOX.bl + BOX.h.repeat(width - 2) + BOX.br, border, level));
  return { rows, width, height: rows.length };
}

export function tocPane(
  doc: Doc,
  selected: number,
  width: number,
  height: number,
  theme: Theme,
  level: ColorLevel,
): Pane {
  const paneWidth = Math.min(Math.max(36, Math.floor(width * 0.6)), width - 4);
  const inner = paneWidth - 4;
  const maxRows = Math.max(3, Math.min(doc.toc.length, height - 6));

  // Keep the selection in view without letting the list jump around it.
  const start = Math.max(0, Math.min(selected - Math.floor(maxRows / 2), doc.toc.length - maxRows));
  const body: string[] = [];

  if (doc.toc.length === 0) {
    body.push(paint('This document has no headings.', { ...theme.faint, bg: theme.overlayBg }, level));
  }

  for (let i = start; i < Math.min(start + maxRows, doc.toc.length); i++) {
    const entry = doc.toc[i]!;
    const indent = '  '.repeat(Math.max(0, entry.level - 1));
    const text = truncate(`${indent}${entry.text}`, inner - 2);
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
        `  ${start + 1}–${Math.min(start + maxRows, doc.toc.length)} of ${doc.toc.length}`,
        { ...theme.faint, bg: theme.overlayBg },
        level,
      ),
    );
  }

  return frame('Contents', body, paneWidth, theme, level);
}

const KEYS: ReadonlyArray<readonly [string, string]> = [
  ['j  k  ↓  ↑', 'one line'],
  ['d  u', 'half a screen'],
  ['f  b  space', 'a full screen'],
  ['g  G', 'top, bottom'],
  ['wheel', 'three lines'],
  ['', ''],
  ['/', 'search this document'],
  ['n  N', 'next, previous match'],
  ['t', 'contents'],
  ['r', 'reload from disk'],
  ['?', 'this list'],
  ['q  esc', 'quit'],
];

export function helpPane(width: number, theme: Theme, level: ColorLevel): Pane {
  const keyWidth = Math.max(...KEYS.map(([k]) => k.length));
  const paneWidth = Math.min(Math.max(40, keyWidth + 30), width - 4);
  const bg: Style = { bg: theme.overlayBg };

  const body = KEYS.map(([key, what]) =>
    key === ''
      ? paint('', bg, level)
      : paint('  ' + key.padEnd(keyWidth), { ...theme.overlayTitle, bold: false }, level) +
        paint('   ' + what, { ...theme.overlayText }, level),
  );

  return frame('Keys', body, paneWidth, theme, level);
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
  return padAnsi(left, width, status, level);
}
