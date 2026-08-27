import { chopSpans, padSpans, spansWidth } from '../core/wrap.js';
import { displayWidth, widest } from '../core/width.js';
import type { LayoutOptions, Span, Theme } from '../core/types.js';
import type { Room } from './layout.js';

const BOX = { tl: '╭', tr: '╮', bl: '╰', br: '╯', h: '─', v: '│' } as const;

/** The band's own cost: a border and a space of padding on each side. */
const FRAME = 4;

/** Narrowest band that still draws two borders with something between them. */
const MIN_BAND = 4;

/** Code cells left over once the frame and the gutter have taken theirs. */
function codeWithin(available: number, gutterWidth: number): number {
  return Math.max(MIN_BAND, available - FRAME - gutterWidth);
}

/** Every span inside the block carries the background, so the band survives the
 *  full reset each span closes with. See `paint` in `core/ansi.ts`. */
function onBand(spans: Span[], bg: string): Span[] {
  return spans.map((s) => ({ ...s, style: { ...s.style, bg } }));
}

export type RenderedCode = { lines: Span[][]; wide: boolean };

/**
 * A fenced code block: rounded frame, language label in the top rule, and an
 * unbroken background band behind the code.
 *
 * Long lines are chopped at the frame rather than truncated — losing the tail
 * of a command someone means to copy is worse than an extra row.
 */
export function layoutCode(
  code: string,
  lang: string,
  room: Room,
  opts: LayoutOptions,
): RenderedCode {
  const width = room.column;
  const { theme } = opts;
  const src = code.replace(/\n+$/, '');
  const srcLines = src.split('\n');

  const highlighted = opts.highlight?.(src, lang) ?? null;
  const body: Span[][] =
    highlighted && highlighted.length === srcLines.length
      ? highlighted.map((l) => onBand(l, theme.codeBg))
      : srcLines.map((l) => [{ text: l, style: { ...theme.codeText } }]);

  const gutterWidth = opts.lineNumbers ? String(srcLines.length).length + 1 : 0;
  const fits = codeWithin(width, gutterWidth);
  /* In scroll mode the block is as wide as its widest line, and the viewport
     shifts sideways over it. Chopping a command someone means to copy is worse
     than making them press `l`. */
  const natural = widest(srcLines, displayWidth, MIN_BAND);
  /* Wrapping chops, but it chops at the page rather than at the text column.
     The band still starts at the column's width, so a three-line snippet lines
     up with the prose exactly as before; only a block too wide for the column
     grows, and only as far as the page can show. Without this a 155-cell
     command on a 300-column terminal was split across two rows of 84 with 110
     columns standing empty beside it.

     One instance of I-41, which is where the rule itself is written down. The
     others are `layoutTable` and `layoutText`, and they are deliberately not
     one shared function: this pads a band and so must cap at `natural`, the
     table redistributes a budget across columns rather than clamping a width,
     and the verbatim path chops without padding and so needs no cap at all. */
  const inner =
    opts.overflow === 'scroll'
      ? Math.max(fits, natural)
      : Math.max(fits, Math.min(natural, codeWithin(room.page, gutterWidth)));
  const frameWidth = inner + FRAME + gutterWidth;
  const wide = frameWidth > width;

  const lines: Span[][] = [];
  lines.push(topRule(lang, frameWidth, theme));

  body.forEach((spans, i) => {
    const chopped = chopSpans(spans, inner);
    chopped.forEach((part, j) => {
      const row: Span[] = [{ text: BOX.v, style: theme.tableBorder }, { text: ' ', style: { bg: theme.codeBg } }];
      if (gutterWidth > 0) {
        // Continuation rows leave the gutter blank, so the numbers still read
        // as one-per-source-line.
        const label = j === 0 ? String(i + 1) : '';
        row.push({
          text: label.padStart(gutterWidth - 1) + ' ',
          style: theme.codeGutter,
        });
      }
      row.push(...padSpans(part, inner, { bg: theme.codeBg }));
      row.push({ text: ' ', style: { bg: theme.codeBg } });
      row.push({ text: BOX.v, style: theme.tableBorder });
      lines.push(row);
    });
  });

  lines.push([
    { text: BOX.bl + BOX.h.repeat(Math.max(0, frameWidth - 2)) + BOX.br, style: theme.tableBorder },
  ]);
  return { lines, wide };
}

function topRule(lang: string, width: number, theme: Theme): Span[] {
  const label = lang.trim();
  if (label === '' || width < label.length + 8) {
    return [{ text: BOX.tl + BOX.h.repeat(Math.max(0, width - 2)) + BOX.tr, style: theme.tableBorder }];
  }
  const spans: Span[] = [
    { text: BOX.tl + BOX.h.repeat(2) + ' ', style: theme.tableBorder },
    { text: label, style: { ...theme.codeLabel, bg: undefined } },
    { text: ' ', style: theme.tableBorder },
  ];
  const used = spansWidth(spans);
  spans.push({ text: BOX.h.repeat(Math.max(0, width - used - 1)) + BOX.tr, style: theme.tableBorder });
  return spans;
}
