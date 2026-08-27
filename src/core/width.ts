/**
 * Display width, not code-unit length. Wide (CJK / emoji) glyphs occupy two
 * terminal cells and combining marks occupy none; using String.length for
 * layout silently breaks alignment. See I-19.
 */

/**
 * Ranges MUST stay in ascending order: `isWide` early-returns on the first
 * range that starts above the code point. An out-of-order entry silently makes
 * every later range unreachable (which is how ⛔ was first measured as width 1).
 */
const WIDE_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x1100, 0x115f],
  [0x231a, 0x231b], [0x2329, 0x232a], [0x23e9, 0x23ec], [0x23f0, 0x23f0],
  [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615], [0x2648, 0x2653],
  [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab],
  [0x26bd, 0x26be], [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4],
  [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5], [0x26fa, 0x26fa],
  [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728],
  [0x274c, 0x274c], [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757],
  [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf], [0x2b1b, 0x2b1c],
  [0x2b50, 0x2b50], [0x2b55, 0x2b55],
  [0x2e80, 0x303e], [0x3041, 0x33ff], [0x3400, 0x4dbf], [0x4e00, 0x9fff],
  [0xa000, 0xa4cf], [0xa960, 0xa97f], [0xac00, 0xd7a3], [0xf900, 0xfaff],
  [0xfe10, 0xfe19], [0xfe30, 0xfe6f], [0xff00, 0xff60], [0xffe0, 0xffe6],
  [0x1f004, 0x1f004], [0x1f0cf, 0x1f0cf], [0x1f18e, 0x1f18e],
  [0x1f191, 0x1f19a], [0x1f200, 0x1f320], [0x1f330, 0x1f335],
  [0x1f337, 0x1f37c], [0x1f380, 0x1f393], [0x1f3a0, 0x1f3ca],
  [0x1f3cf, 0x1f3d3], [0x1f3e0, 0x1f3f0], [0x1f400, 0x1f43e],
  [0x1f440, 0x1f4fc], [0x1f500, 0x1f53d], [0x1f550, 0x1f567],
  [0x1f5fb, 0x1f64f], [0x1f680, 0x1f6c5], [0x1f900, 0x1f9ff],
  [0x20000, 0x3fffd],
];

const VARIATION_SELECTOR_16 = 0xfe0f;

/** Joins the glyph before it to the one after: `👩` + ZWJ + `💻` is one person. */
const ZERO_WIDTH_JOINER = 0x200d;

/** U+1F3FB..U+1F3FF recolour the emoji before them rather than drawing. */
const SKIN_TONE = [0x1f3fb, 0x1f3ff] as const;

function isSkinTone(codePoint: number): boolean {
  return codePoint >= SKIN_TONE[0] && codePoint <= SKIN_TONE[1];
}

function isWide(codePoint: number): boolean {
  for (const [lo, hi] of WIDE_RANGES) {
    if (codePoint < lo) return false;
    if (codePoint <= hi) return true;
  }
  return false;
}

function isZeroWidth(codePoint: number): boolean {
  // Combining marks, ZWJ/ZWNJ, variation selectors, control chars.
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    codePoint === 0x20e3 ||
    (codePoint < 0x20 && codePoint !== 0x00) ||
    codePoint === 0x7f
  );
}

/** Printable ASCII: one cell each, no marks, no joiners, no second cell. */
const ASCII_LOW = 0x20;
const ASCII_HIGH = 0x7e;

/**
 * The width of a run of plain ASCII, or -1 when it is not one.
 *
 * Nearly every line of nearly every document takes this path, and it earns its
 * place: `displayWidth` runs once per row while a frame is composed, and the
 * general form walks code points through an iterator with a range search per
 * glyph. A `charCodeAt` loop that gives up on the first byte it cannot vouch
 * for is several times cheaper, and for what it accepts the answer is simply
 * the length. Every character it admits is one cell — no combining mark, no
 * joiner, no variation selector and nothing wide lives below U+007F.
 */
function asciiWidth(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < ASCII_LOW || code > ASCII_HIGH) return -1;
  }
  return text.length;
}

/**
 * Terminal cells occupied by `s`.
 *
 * A joined emoji sequence is **one** glyph of two cells, however many code
 * points spell it. Counting its parts separately measured `👨‍👩‍👧‍👦` as eight
 * cells and `👩‍💻` as four, so every table column holding one came out ragged
 * and every row carrying one was measured wider than it draws. A skin tone
 * recolours the emoji before it and draws nothing of its own, for the same
 * reason. See I-2.
 */
export function displayWidth(s: string): number {
  const ascii = asciiWidth(s);
  if (ascii >= 0) return ascii;

  let w = 0;
  let prevWidth = 0;
  /** True between a joiner and the glyph it swallows. */
  let joined = false;
  for (const ch of s) {
    const codePoint = ch.codePointAt(0)!;
    if (codePoint === ZERO_WIDTH_JOINER) {
      /* The parts after a joiner add nothing, but the glyph they make is an
         emoji and an emoji is two cells — so a narrow part before the joiner
         still widens, exactly as U+FE0F widens one. `🏴` + ZWJ + `☠` is a
         two-cell pirate flag, though `🏴` alone measures one. */
      if (prevWidth === 1) {
        w += 1;
        prevWidth = 2;
      }
      joined = true;
      continue;
    }
    if (codePoint === VARIATION_SELECTOR_16) {
      // U+FE0F requests emoji presentation, which renders the preceding
      // narrow character in two cells (e.g. "⚠️" vs "⚠").
      if (!joined && prevWidth === 1) {
        w += 1;
        prevWidth = 2;
      }
      continue;
    }
    if (isZeroWidth(codePoint) || isSkinTone(codePoint)) continue;
    if (joined) {
      // Part of the glyph before it, not a glyph of its own.
      joined = false;
      continue;
    }
    prevWidth = isWide(codePoint) ? 2 : 1;
    w += prevWidth;
  }
  return w;
}

/**
 * The marks that bind to the character before them. A subset of `isZeroWidth`:
 * that one also covers control bytes, which are their own characters and must
 * not be absorbed into a neighbour.
 */
function isCombining(codePoint: number): boolean {
  return (
    (codePoint >= 0x0300 && codePoint <= 0x036f) ||
    (codePoint >= 0x200b && codePoint <= 0x200f) ||
    (codePoint >= 0xfe00 && codePoint <= 0xfe0f) ||
    codePoint === 0x20e3
  );
}

/**
 * Walk `s` one *cluster* at a time — a base code point with every mark that
 * binds to it — yielding each with the cells it occupies.
 *
 * `displayWidth` is deliberately stateful: U+FE0F widens the character before
 * it. Summing it per code point is therefore not the same as calling it on the
 * whole string — `⚠️` measures 2, but its two code points measure 1 and 0. Any
 * scanner that accumulates width while walking a string has to advance by
 * cluster or it under-counts, and a cut taken at a code-point boundary can
 * strand a mark from its base. Both halves of I-2, and the same trap
 * `expandTabs` documents in `sanitize.ts`.
 */
export function* clusters(s: string): Generator<readonly [string, number]> {
  let cur = '';
  /** True when the last code point taken was a joiner, so the next one binds. */
  let joined = false;
  for (const ch of s) {
    const codePoint = ch.codePointAt(0)!;
    /* A joined emoji has to come out whole. Its parts are ordinary emoji code
       points, so nothing about the one after a joiner says it binds backwards
       except the joiner itself — cutting between them would leave half a
       family on one row and half on the next. */
    if (cur !== '' && (joined || isCombining(codePoint) || isSkinTone(codePoint))) {
      cur += ch;
      joined = codePoint === ZERO_WIDTH_JOINER;
      continue;
    }
    if (cur !== '') yield [cur, displayWidth(cur)];
    cur = ch;
    joined = false;
  }
  if (cur !== '') yield [cur, displayWidth(cur)];
}

/**
 * The largest measurement over `items`, or `floor` when there are none.
 *
 * `Math.max(...items.map(measure))` reads better and throws: every element
 * becomes an argument, and V8 gives up somewhere past a hundred thousand of
 * them with a `RangeError` that no caller is expecting and no `try` around the
 * layout intercepts. A file with that many lines is an ordinary log, and under
 * `--wrap` a single wide code fence produces one row per *screen line* rather
 * than per source line — so the count is not bounded by anything a person
 * wrote. It took the viewer down mid-resize, which is the worst moment for it.
 */
export function widest<T>(items: readonly T[], measure: (item: T) => number, floor = 0): number {
  let most = floor;
  for (const item of items) {
    const width = measure(item);
    if (width > most) most = width;
  }
  return most;
}

/** Truncate to at most `max` cells, appending an ellipsis when cut. */
export function truncate(s: string, max: number): string {
  if (max <= 0) return '';
  if (displayWidth(s) <= max) return s;
  if (max === 1) return '…';
  let out = '';
  let w = 0;
  for (const [ch, cw] of clusters(s)) {
    if (w + cw > max - 1) break;
    out += ch;
    w += cw;
  }
  return out + '…';
}

/** Pad to exactly `n` cells (truncating if needed). */
export function padEnd(s: string, n: number): string {
  const t = truncate(s, n);
  return t + ' '.repeat(Math.max(0, n - displayWidth(t)));
}

export function padStart(s: string, n: number): string {
  const t = truncate(s, n);
  return ' '.repeat(Math.max(0, n - displayWidth(t))) + t;
}
