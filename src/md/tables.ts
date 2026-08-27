import type { Tokens } from 'marked';
import { padSpans, spansWidth, truncateSpans } from '../core/wrap.js';
import { inlineSpans, type InlineContext } from './inline.js';
import type { LayoutOptions, Span } from '../core/types.js';
import type { Room } from './layout.js';
import { widest } from '../core/width.js';

const B = {
  tl: '┌', tm: '┬', tr: '┐',
  ml: '├', mm: '┼', mr: '┤',
  bl: '└', bm: '┴', br: '┘',
  h: '─', v: '│',
} as const;

type Align = 'left' | 'center' | 'right';

/** Narrowest a column may be squeezed to before shrinking stops helping. */
const MIN_COLUMN = 3;

/**
 * Solve column widths.
 *
 * Shrink-largest-first rather than scaling every column by the same factor: a
 * table with one prose column and three of numbers should lose cells from the
 * prose, not take a character off each of the numbers.
 */
function solveWidths(natural: number[], budget: number): number[] {
  const w = [...natural];
  let total = w.reduce((a, b) => a + b, 0);
  while (total > budget) {
    let fattest = 0;
    for (let i = 1; i < w.length; i++) if (w[i]! > w[fattest]!) fattest = i;
    /* Every column is at the floor and it still does not fit: a table with
       enough columns cannot be made narrow enough by shrinking alone, because
       the frame alone costs three cells per column. The row is returned
       oversized and the viewport chops it — see `wide` below, and I-26. */
    if (w[fattest]! <= MIN_COLUMN) break;
    w[fattest]!--;
    total--;
  }
  return w;
}

function alignSpans(spans: Span[], width: number, align: Align): Span[] {
  const cut = truncateSpans(spans, width);
  const pad = width - spansWidth(cut);
  if (pad <= 0) return cut;
  if (align === 'right') return [{ text: ' '.repeat(pad), style: {} }, ...cut];
  if (align === 'center') {
    const l = Math.floor(pad / 2);
    return [{ text: ' '.repeat(l), style: {} }, ...cut, { text: ' '.repeat(pad - l), style: {} }];
  }
  return padSpans(cut, width, {});
}

export type RenderedTable = { lines: Span[][]; wide: boolean };

export function layoutTable(
  token: Tokens.Table,
  room: Room,
  opts: LayoutOptions,
  ctx: InlineContext,
): RenderedTable {
  const width = room.column;
  const { theme } = opts;
  const header = token.header.map((c) => inlineSpans(c.tokens, theme.tableHeader, ctx));
  const rows = token.rows.map((r) => r.map((c) => inlineSpans(c.tokens, theme.text, ctx)));
  const cols = header.length;
  if (cols === 0) return { lines: [], wide: false };

  const aligns: Align[] = token.align.map((a) => (a === 'center' || a === 'right' ? a : 'left'));

  const natural = header.map((h, i) =>
    widest(rows, (r) => (r[i] ? spansWidth(r[i]!) : 0), Math.max(spansWidth(h), 1)),
  );
  // Frame and padding: one '│' per boundary plus a space either side of a cell.
  const chrome = cols * 3 + 1;
  /* Scroll mode keeps every column at its natural width and lets the viewport
     move over the table, rather than truncating cells nobody can then read.

     Wrapping does have to cut, but it cuts against the page, not the text
     column. `solveWidths` only ever
     shrinks a column below its natural width, so a table that already fits the
     column is unchanged; a wider one keeps its cells instead of having them cut
     to a width the terminal was never limited to. This is the one path where
     truncation loses text outright — `--wrap` and one-shot printing have no
     viewport to pan — so the budget has to be the room that actually exists. */
  const widths =
    opts.overflow === 'scroll'
      ? natural
      : solveWidths(natural, Math.max(cols * MIN_COLUMN, room.page - chrome));
  /* `wide` means "the viewport may scroll sideways over this". Under `wrap`
     the reader has asked for the opposite — chop it to fit — so an oversized
     row is left un-flagged and the viewport clips it with a mark instead of
     offering a sideways scroll the flag promised and `--wrap` denied. */
  const overflows = widths.reduce((a, b) => a + b, 0) + chrome > width;
  const wide = opts.overflow === 'scroll' && overflows;

  const rule = (l: string, m: string, r: string): Span[] => [
    { text: l + widths.map((w) => B.h.repeat(w + 2)).join(m) + r, style: theme.tableBorder },
  ];

  const dataRow = (cells: Span[][], fallback: Span['style']): Span[] => {
    const out: Span[] = [{ text: B.v, style: theme.tableBorder }];
    widths.forEach((w, i) => {
      out.push({ text: ' ', style: {} });
      out.push(...alignSpans(cells[i] ?? [{ text: '', style: fallback }], w, aligns[i] ?? 'left'));
      out.push({ text: ' ', style: {} });
      out.push({ text: B.v, style: theme.tableBorder });
    });
    return out;
  };

  const lines: Span[][] = [rule(B.tl, B.tm, B.tr), dataRow(header, theme.tableHeader), rule(B.ml, B.mm, B.mr)];
  for (const r of rows) lines.push(dataRow(r, theme.text));
  lines.push(rule(B.bl, B.bm, B.br));
  return { lines, wide };
}
