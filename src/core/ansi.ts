/**
 * Styling primitives. Everything the layout engine emits goes through here, so
 * colour capability, NO_COLOR and ANSI-aware measurement all have exactly one
 * implementation.
 */

import { displayWidth } from './width.js';

/** 0 = no colour at all, 2 = 256 colours, 3 = 24-bit. */
export type ColorLevel = 0 | 2 | 3;

export type Style = {
  fg?: string; // '#rrggbb'
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  inverse?: boolean;
};

export const ESC = '\x1b';
export const RESET = '\x1b[0m';

/** What the terminal can actually show. `--plain` and NO_COLOR force 0. */
export function detectColorLevel(env: NodeJS.ProcessEnv = process.env): ColorLevel {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return 0;
  const force = env.FORCE_COLOR;
  if (force === '0') return 0;
  if (force === '3') return 3;
  if (force === '2' || force === '1') return 2;
  const ct = (env.COLORTERM ?? '').toLowerCase();
  if (ct === 'truecolor' || ct === '24bit') return 3;
  const term = (env.TERM ?? '').toLowerCase();
  if (term === 'dumb' || term === '') return 0;
  if (term.includes('256')) return 2;
  /* Terminal.app, and anything else reporting a plain TERM, still does 256.
     Guessing 2 is safe: a 16-colour terminal maps a 256-colour code to its
     nearest palette entry rather than printing it as literal text. */
  return 2;
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

const CUBE_LEVELS = [0, 95, 135, 175, 215, 255];

function nearestCubeIndex(v: number): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < CUBE_LEVELS.length; i++) {
    const d = Math.abs(CUBE_LEVELS[i]! - v);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function dist(a: [number, number, number], b: [number, number, number]): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Nearest xterm-256 index, considering both the colour cube and the grey ramp. */
export function to256(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const ri = nearestCubeIndex(r);
  const gi = nearestCubeIndex(g);
  const bi = nearestCubeIndex(b);
  const cubeDist = dist([r, g, b], [CUBE_LEVELS[ri]!, CUBE_LEVELS[gi]!, CUBE_LEVELS[bi]!]);

  // The grey ramp is 24 steps of 8 + 10i, and beats the cube for near-neutrals.
  const gIdx = Math.min(23, Math.max(0, Math.round(((r + g + b) / 3 - 8) / 10)));
  const grey = 8 + 10 * gIdx;
  const greyDist = dist([r, g, b], [grey, grey, grey]);

  return greyDist < cubeDist ? 232 + gIdx : 16 + 36 * ri + 6 * gi + bi;
}

function colorCode(hex: string, level: ColorLevel, bg: boolean): string {
  const lead = bg ? '48' : '38';
  if (level === 3) {
    const [r, g, b] = hexToRgb(hex);
    return `${lead};2;${r};${g};${b}`;
  }
  return `${lead};5;${to256(hex)}`;
}

/** The SGR introducer for `style`; '' when the style is empty or colour is off. */
export function sgr(style: Style, level: ColorLevel): string {
  if (level === 0) return '';
  const parts: string[] = [];
  if (style.bold) parts.push('1');
  if (style.dim) parts.push('2');
  if (style.italic) parts.push('3');
  if (style.underline) parts.push('4');
  if (style.inverse) parts.push('7');
  if (style.strike) parts.push('9');
  if (style.fg) parts.push(colorCode(style.fg, level, false));
  if (style.bg) parts.push(colorCode(style.bg, level, true));
  return parts.length > 0 ? `\x1b[${parts.join(';')}m` : '';
}

/**
 * Style one span. Every span closes with a full reset rather than an
 * attribute-specific off-code: nesting resets is where terminal styling usually
 * goes wrong. A code block's background is therefore re-applied to every span
 * inside it (see `md/code.ts`) so that it survives these resets.
 */
export function paint(text: string, style: Style, level: ColorLevel): string {
  if (level === 0) return text;
  const open = sgr(style, level);
  return open === '' ? text : open + text + RESET;
}

/**
 * Style a span whose only job is to stand out from the text around it.
 *
 * `paint` returns the text untouched when colour is off, which is right for
 * everything the layout draws: a heading keeps its rule, a task its box, code
 * its frame, so nothing is lost along with the colour. Interactive state has no
 * such second channel. A search match differs from its surroundings by
 * background alone, so at level 0 it disappeared entirely and the match count in
 * the status bar was the only evidence it existed — colour as the only signal,
 * which pillar 2 does not allow.
 *
 * Reverse video stands in for the fg/bg pair. It is an attribute rather than a
 * colour, so `NO_COLOR` is still honoured — it asks for no colour, not for no
 * emphasis, the same way `less` standouts its matches. Attributes the style
 * already carries survive, so the current match keeps its bold and stays
 * distinct from the rest. Width is unaffected: these are zero-cell bytes, and
 * every composer measures with `ansiWidth`.
 *
 * Only for spans the reader is currently acting on. Anything the document
 * itself contributes goes through `paint`, so piped output stays clean (I-11).
 */
export function paintState(text: string, style: Style, level: ColorLevel): string {
  if (level !== 0) return paint(text, style, level);
  const parts = ['7'];
  if (style.bold) parts.push('1');
  if (style.underline) parts.push('4');
  return `\x1b[${parts.join(';')}m${text}${RESET}`;
}

/** An OSC 8 hyperlink, which capable terminals make clickable. */
export function hyperlink(text: string, url: string, level: ColorLevel): string {
  if (level === 0) return text;
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

const SGR_RE = /^\x1b\[[0-9;:]*m/;
const OSC8_RE = /^\x1b\]8;;[^\x07\x1b]*(?:\x07|\x1b\\)/;
const OTHER_ESC_RE = /^\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|.)/;
const ANY_ANSI_RE = /\x1b(?:\[[0-9;:?]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\))/g;

/** The text a user actually sees, with all escapes removed. */
export function stripAnsi(s: string): string {
  return s.replace(ANY_ANSI_RE, '');
}

/** Display width of a string that may contain escapes. */
export function ansiWidth(s: string): number {
  return displayWidth(stripAnsi(s));
}

type Chunk = { esc: string } | { ch: string; w: number };

function tokenize(s: string): Chunk[] {
  const out: Chunk[] = [];
  let i = 0;
  while (i < s.length) {
    if (s[i] === ESC) {
      const rest = s.slice(i);
      const m = SGR_RE.exec(rest) ?? OSC8_RE.exec(rest) ?? OTHER_ESC_RE.exec(rest);
      if (m) {
        out.push({ esc: m[0] });
        i += m[0].length;
        continue;
      }
    }
    /* Absorb zero-width code points into the character they modify. A slice
       must never separate a base glyph from its combining mark, and U+FE0F
       widens the glyph before it — so measuring per code point would disagree
       with `displayWidth` over the whole string. */
    let ch = String.fromCodePoint(s.codePointAt(i)!);
    i += ch.length;
    while (i < s.length) {
      const next = String.fromCodePoint(s.codePointAt(i)!);
      if (next === ESC || displayWidth(next) !== 0) break;
      ch += next;
      i += next.length;
    }
    out.push({ ch, w: displayWidth(ch) });
  }
  return out;
}

const OSC8_CLOSE = /^\x1b\]8;;(?:\x07|\x1b\\)$/;

/**
 * Slice by display cells, carrying styling state across the cut.
 *
 * Naively cutting an ANSI string mid-sequence either drops the styling that was
 * open at `start` or leaves a dangling escape. This replays SGR state up to
 * `start`, emits it, then closes whatever is still open at `end`. The search
 * overlay depends on it: it re-styles a range inside an already-styled line.
 */
export function sliceAnsi(s: string, start: number, end: number): string {
  if (end <= start) return '';
  const chunks = tokenize(s);
  let active: string[] = [];
  let link: string | null = null;
  let col = 0;
  let out = '';
  let opened = false;

  const openState = () => {
    if (opened) return;
    opened = true;
    out += active.join('');
    if (link !== null) out += link;
  };

  for (const c of chunks) {
    if ('esc' in c) {
      if (SGR_RE.test(c.esc)) {
        const body = c.esc.slice(2, -1);
        // Both \x1b[0m and \x1b[m mean "reset everything".
        if (body === '' || body === '0') active = [];
        else active.push(c.esc);
      } else if (OSC8_RE.test(c.esc)) {
        link = OSC8_CLOSE.test(c.esc) ? null : c.esc;
      }
      if (col >= start && col < end) {
        openState();
        out += c.esc;
      }
      continue;
    }
    const next = col + c.w;
    if (next > start && col < end) {
      openState();
      /* A wide glyph straddling either edge becomes spaces, so the slice is
         exactly as wide as asked rather than one cell over or under. */
      const visible = Math.min(next, end) - Math.max(col, start);
      out += col < start || next > end ? ' '.repeat(Math.max(0, visible)) : c.ch;
    }
    col = next;
    if (col >= end) break;
  }

  if (opened) {
    if (link !== null) out += '\x1b]8;;\x07';
    if (active.length > 0) out += RESET;
  }
  return out;
}

/** Pad an ANSI string to exactly `n` cells, filling with `style`. */
export function padAnsi(s: string, n: number, style: Style, level: ColorLevel): string {
  const w = ansiWidth(s);
  if (w >= n) return s;
  return s + paint(' '.repeat(n - w), style, level);
}
