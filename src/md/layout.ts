import type { Token, Tokens } from 'marked';
import type { Style } from '../core/ansi.js';
import { linkRanges, padSpans, plainSpans, renderSpans, spansWidth, wrapSpans } from '../core/wrap.js';
import type { CodeBlock, Doc, HeadingRef, LayoutOptions, Line, Span, TocEntry } from '../core/types.js';
import { inlineSpans, type InlineContext } from './inline.js';
import { layoutCode } from './code.js';
import { layoutTable } from './tables.js';
import { parseMarkdown, type FrontMatter } from './parse.js';
import { displayWidth, truncate, widest } from '../core/width.js';
import { sanitizeSource } from '../core/sanitize.js';

/** Breathing room between the terminal edge and the text column. */
const MARGIN = 2;
/** Below this the text column stops being worth centring. */
const MIN_INNER = 20;

/** Widest a front-matter key column may grow before the values start too late. */
const MAX_KEY_COLUMN = 20;

const BULLETS = ['•', '◦', '▪', '·'];

type Out = { lines: Line[]; toc: TocEntry[]; code: CodeBlock[]; block: number };

type Ctx = {
  out: Out;
  opts: LayoutOptions;
  ictx: InlineContext;
  left: number;
  inner: number;
  /** Total cells the frame may draw into, which is what a wide block bleeds to. */
  page: number;
  /** Cells of indentation inside the text column, before any quote bars. */
  indent: number;
  /** Cells reserved for a list marker, blank on continuation rows. */
  hang: number;
  /** Repeated on every row of the block — quote bars, mainly. */
  prefix: Span[];
  /** The marker for the next row emitted, consumed once. */
  pending: { marker: Span[] | null };
  /** Body text style for this context. */
  base: Style;
  /** Tight lists get no blank rows between items. */
  tight: boolean;
};

export function geometry(opts: LayoutOptions): { left: number; inner: number; page: number } {
  const total = Math.max(MIN_INNER, opts.width);
  let inner = opts.maxWidth > 0 ? Math.min(total - MARGIN * 2, opts.maxWidth) : total - MARGIN * 2;
  if (inner < MIN_INNER) inner = Math.max(1, total - 2);
  return { left: Math.max(1, Math.floor((total - inner) / 2)), inner, page: total };
}

/**
 * The same context with the centring margin narrowed until a natural-width
 * block fits the page.
 *
 * The margin is decoration; the text is not. A code block or table laid out at
 * its natural width is not wrapped to the text column, so on a terminal much
 * wider than `maxWidth` it was indented to line up with an 88-cell column and
 * then chopped at the right edge — a 155-cell command on a 200-column terminal
 * lost its tail behind a 55-cell margin wide enough to have shown the whole
 * thing, and the reader had to press `l` to read past blank space. See I-41.
 *
 * Pulled back only as far as the block needs, so a block that already fits
 * stays aligned with the prose around it, and never past `MARGIN`, so it still
 * reads as a page rather than as output flush against the terminal edge.
 * Structural indentation — a list's, a quote's — is left alone: that is what
 * says the block belongs to the item containing it.
 */
export function bleedLeft(left: number, page: number, structural: number, natural: number): number {
  // A margin is kept on the right as well, or a block that used the whole
  // budget would sit flush against the edge with a margin only on one side.
  const spare = page - structural - natural - MARGIN;
  if (spare >= left) return left;
  return Math.max(Math.min(left, MARGIN), spare);
}

function bleed(ctx: Ctx, lines: readonly Span[][]): Ctx {
  /* Only a block at the top level moves. Narrowing the margin shifts the whole
     lead, and inside a list or a quote the lead is what ties the block to what
     contains it: a fenced block in a quoted list item dragged the quote bar
     from column 37 to column 4 for its three rows and back again, so the rule
     down the side of the quote broke and there was no telling which rows were
     still inside it. The block was cut at the right edge anyway, so the jog
     bought nothing at all. A nested block keeps its place and is panned with
     `l`, exactly as before. */
  if (lines.length === 0 || structuralWidth(ctx) > 0) return ctx;
  return { ...ctx, left: bleedLeft(ctx.left, ctx.page, 0, widest(lines, spansWidth)) };
}

function structuralWidth(ctx: Ctx): number {
  return ctx.indent + spansWidth(ctx.prefix) + ctx.hang;
}

/**
 * The two widths a natural-width block is fitted against.
 *
 * `column` is the text column it aligns with when it fits there; `page` is how
 * far it may grow before anything is cut. They were the same number, which is
 * why `--wrap` and one-shot output cut a wide table's cells to 88 on a
 * 300-column terminal — discarding text with two hundred columns standing
 * empty, where the reader has no viewport to pan and so no way to get it back.
 */
export type Room = { column: number; page: number };

function room(ctx: Ctx): Room {
  const column = available(ctx);
  return { column, page: Math.max(column, ctx.page - structuralWidth(ctx) - MARGIN * 2) };
}

function available(ctx: Ctx): number {
  return Math.max(4, ctx.inner - ctx.indent - spansWidth(ctx.prefix) - ctx.hang);
}

/**
 * Lead cells for one row: margin, indent, block prefix, then the marker cell.
 *
 * The order matters for nesting. Indent before prefix puts a list's indentation
 * outside a quote bar it contains; prefix before the marker cell puts the bar
 * outside a list the quote contains. Both nest correctly at any depth.
 */
function lead(ctx: Ctx, marker: Span[] | null): Span[] {
  const out: Span[] = [{ text: ' '.repeat(ctx.left + ctx.indent), style: {} }, ...ctx.prefix];
  if (ctx.hang > 0) out.push(...padSpans(marker ?? [], ctx.hang, {}));
  return out;
}

function push(ctx: Ctx, spans: Span[], heading?: HeadingRef, wide?: boolean): void {
  const line: Line = {
    ansi: renderSpans(spans, ctx.opts.level, ctx.opts.links === 'osc8'),
    plain: plainSpans(spans),
    block: ctx.out.block,
  };
  const links = linkRanges(spans);
  if (links.length > 0) line.links = links;
  if (wide) line.wide = true;
  if (heading) {
    line.heading = heading;
    ctx.out.toc.push({ ...heading, line: ctx.out.lines.length });
  }
  ctx.out.lines.push(line);
}

/** Emit pre-built row content that must not be re-wrapped (code, tables). */
function emitRaw(ctx: Ctx, spans: Span[], heading?: HeadingRef, wide?: boolean): void {
  const marker = ctx.pending.marker;
  ctx.pending.marker = null;
  push(ctx, [...lead(ctx, marker), ...spans], heading, wide);
}

function emit(ctx: Ctx, body: Span[], heading?: HeadingRef): void {
  const width = available(ctx);
  // A hard break (`br`) arrives as a lone newline span and must start a row
  // rather than collapse into a space.
  const segments: Span[][] = [[]];
  for (const s of body) {
    if (s.text === '\n') segments.push([]);
    else segments[segments.length - 1]!.push(s);
  }
  let first = true;
  for (const seg of segments) {
    for (const row of wrapSpans(seg, width)) {
      emitRaw(ctx, row, first ? heading : undefined);
      first = false;
    }
  }
}

function blank(ctx: Ctx): void {
  // Quote bars continue through blank rows, so a quote reads as one block.
  push(ctx, ctx.prefix.length > 0 ? lead(ctx, null) : []);
}

function renderHeading(t: Tokens.Heading, ctx: Ctx): void {
  const { theme } = ctx.opts;
  const spans = inlineSpans(t.tokens, {}, ctx.ictx);
  const ref: HeadingRef = { level: t.depth, text: plainSpans(spans).trim() };
  const width = available(ctx);

  if (ctx.out.lines.length > 0) blank(ctx);

  if (t.depth === 1) {
    // A filled band, which is the one place colour carries real weight.
    const rows = wrapSpans(inlineSpans(t.tokens, theme.h1, ctx.ictx), width - 2);
    rows.forEach((row, i) => {
      const banded = row.map((s) => ({ ...s, style: { ...s.style, bg: theme.h1.bg } }));
      const content: Span[] = [{ text: ' ', style: theme.h1 }, ...banded];
      emitRaw(ctx, padSpans(content, width, theme.h1), i === 0 ? ref : undefined);
    });
    return;
  }

  if (t.depth === 2) {
    const rows = wrapSpans(inlineSpans(t.tokens, theme.h2, ctx.ictx), width);
    rows.forEach((row, i) => {
      const last = i === rows.length - 1;
      const used = spansWidth(row);
      const rule = last && width - used > 2
        ? [{ text: ' ' + '─'.repeat(width - used - 1), style: theme.headingRule }]
        : [];
      emitRaw(ctx, [...row, ...rule], i === 0 ? ref : undefined);
    });
    return;
  }

  const style = t.depth === 3 ? theme.h3 : theme.h4;
  const marker: Span[] = [{ text: '#'.repeat(t.depth), style: theme.faint }];
  const sub: Ctx = { ...ctx, hang: t.depth + 1, pending: { marker } };
  emit(sub, inlineSpans(t.tokens, style, ctx.ictx), ref);
}

function renderList(t: Tokens.List, ctx: Ctx, depth: number): void {
  const { theme } = ctx.opts;
  const start = Number(t.start) || 1;
  const digits = String(start + t.items.length - 1).length;
  const base = ctx.indent + ctx.hang;

  t.items.forEach((item, i) => {
    const task = item.task === true;
    const marker: Span[] = task
      ? [{ text: item.checked ? '☑' : '☐', style: item.checked ? theme.taskDone : theme.taskTodo }]
      : t.ordered
        ? [{ text: `${start + i}.`.padStart(digits + 1), style: theme.listMarker }]
        : [{ text: BULLETS[depth % BULLETS.length]!, style: theme.listMarker }];
    const hang = t.ordered && !task ? digits + 2 : 2;

    const itemCtx: Ctx = {
      ...ctx,
      indent: base,
      hang,
      pending: { marker },
      tight: !t.loose,
      base: task && item.checked ? { ...ctx.base, ...theme.faint } : ctx.base,
    };
    renderTokens(item.tokens, itemCtx, depth + 1);
    if (t.loose && i < t.items.length - 1) blank(itemCtx);
  });
}

function renderQuote(t: Tokens.Blockquote, ctx: Ctx, depth: number): void {
  const { theme } = ctx.opts;
  const qctx: Ctx = {
    ...ctx,
    indent: ctx.indent + ctx.hang,
    hang: 0,
    pending: { marker: null },
    prefix: [...ctx.prefix, { text: '▎', style: theme.quoteBar }, { text: ' ', style: {} }],
    base: { ...ctx.base, ...theme.quoteText },
    tight: false,
  };
  renderTokens(t.tokens, qctx, depth);
}

function renderToken(t: Token, ctx: Ctx, depth: number): void {
  const { theme } = ctx.opts;
  switch (t.type) {
    case 'heading':
      renderHeading(t as Tokens.Heading, ctx);
      return;
    case 'paragraph':
      emit(ctx, inlineSpans((t as Tokens.Paragraph).tokens, ctx.base, ctx.ictx));
      return;
    case 'text': {
      const tok = t as Tokens.Text;
      emit(ctx, tok.tokens ? inlineSpans(tok.tokens, ctx.base, ctx.ictx) : [{ text: tok.text, style: ctx.base }]);
      return;
    }
    case 'code': {
      const tok = t as Tokens.Code;
      const block = layoutCode(tok.text, tok.lang ?? '', room(ctx), ctx.opts);
      const bctx = bleed(ctx, block.lines);
      const from = ctx.out.lines.length;
      for (const row of block.lines) emitRaw(bctx, row, undefined, block.wide);
      ctx.out.code.push({
        from,
        to: ctx.out.lines.length - 1,
        lang: (tok.lang ?? '').trim(),
        code: tok.text.replace(/\n+$/, ''),
      });
      return;
    }
    case 'blockquote':
      renderQuote(t as Tokens.Blockquote, ctx, depth);
      return;
    case 'list':
      renderList(t as Tokens.List, ctx, depth);
      return;
    case 'table': {
      const table = layoutTable(t as Tokens.Table, room(ctx), ctx.opts, ctx.ictx);
      const bctx = bleed(ctx, table.lines);
      for (const row of table.lines) emitRaw(bctx, row, undefined, table.wide);
      return;
    }
    case 'hr':
      emitRaw(ctx, [{ text: '─'.repeat(available(ctx)), style: theme.rule }]);
      return;
    case 'html': {
      const text = (t as Tokens.HTML).text.replace(/\n+$/, '');
      if (text.trim() === '') return;
      // Raw HTML is content someone wrote; dimming it says "not prose" without
      // dropping it. Comments are the exception — they are not for the reader.
      if (/^\s*<!--/.test(text)) return;
      for (const row of text.split('\n')) emit(ctx, [{ text: row, style: theme.faint }]);
      return;
    }
    case 'space':
    case 'def':
      return;
    default: {
      const raw = (t as { text?: string }).text;
      if (raw && raw.trim() !== '') emit(ctx, [{ text: raw, style: ctx.base }]);
    }
  }
}

function renderTokens(tokens: Token[], ctx: Ctx, depth: number): void {
  const blocks = tokens.filter((t) => t.type !== 'space' && t.type !== 'def');
  blocks.forEach((t, i) => {
    ctx.out.block++;
    renderToken(t, ctx, depth);
    if (i < blocks.length - 1 && !ctx.tight) blank(ctx);
  });
}

function renderFrontMatter(fm: FrontMatter, ctx: Ctx): void {
  const { theme } = ctx.opts;
  /* Display cells, not `String.length` — a CJK key is twice the cells its
     length claims, and the column it sits in is measured in cells (I-2). The
     key is then cut to the cap it was measured against: `padSpans` can only
     add, so a key longer than `keyWidth` used to push its value flush against
     itself with no separator at all and carry the row past the frame (I-1). */
  const keyWidth = Math.min(MAX_KEY_COLUMN, widest(fm, ([k]) => displayWidth(k)));
  /* The key column goes through the marker mechanism rather than into the text
     itself: `emit` normalises runs of whitespace, so padding written into a
     span would be collapsed back to one space and the column would not line
     up. Anything aligned has to live in the lead, not the body. */
  for (const [k, v] of fm) {
    const marker: Span[] = [{ text: truncate(k, keyWidth), style: theme.frontMatterKey }];
    const row: Ctx = { ...ctx, hang: keyWidth + 2, pending: { marker } };
    emit(row, [{ text: v, style: theme.frontMatterValue }]);
  }
  emitRaw(ctx, [{ text: '─'.repeat(available(ctx)), style: theme.rule }]);
  blank(ctx);
}

function renderRefs(refs: string[], ctx: Ctx): void {
  const { theme } = ctx.opts;
  blank(ctx);
  emitRaw(ctx, [{ text: '─'.repeat(available(ctx)), style: theme.rule }]);
  const width = String(refs.length).length;
  refs.forEach((href, i) => {
    const marker: Span[] = [{ text: `[${String(i + 1).padStart(width)}]`, style: theme.faint }];
    const row: Ctx = { ...ctx, hang: width + 3, pending: { marker } };
    emit(row, [{ text: href, style: theme.linkUrl }]);
  });
}

/**
 * Markdown source to rendered rows.
 *
 * Pure: the same (src, options) always produces identical output, which is what
 * lets the viewer treat the result as an immutable buffer and never recompute
 * it while scrolling. See I-3 and I-4.
 */
export function layoutDoc(src: string, opts: LayoutOptions): Doc {
  /* I-29: control bytes are neutralised before anything parses or measures
     them, so no path downstream can carry one into a rendered row. */
  const { frontMatter, tokens } = parseMarkdown(sanitizeSource(src));
  const { left, inner, page } = geometry(opts);
  const out: Out = { lines: [], toc: [], code: [], block: 0 };
  const ictx: InlineContext = { theme: opts.theme, links: opts.links, refs: [] };
  const ctx: Ctx = {
    out,
    opts,
    ictx,
    left,
    inner,
    page,
    indent: 0,
    hang: 0,
    prefix: [],
    pending: { marker: null },
    base: opts.theme.text,
    tight: false,
  };

  if (frontMatter) renderFrontMatter(frontMatter, ctx);
  renderTokens(tokens, ctx, 0);
  if (opts.links === 'ref' && ictx.refs.length > 0) renderRefs(ictx.refs, ctx);

  return finalize(out, opts, inner);
}

/** Collapse blank runs, trim the ends, and drop trailing blanks when colour is
 *  off so piped output is clean. */
function finalize(out: Out, opts: LayoutOptions, inner: number): Doc {
  const kept: Line[] = [];
  const moved = new Map<number, number>();

  out.lines.forEach((line, i) => {
    const isBlank = line.plain.trim() === '' && line.heading === undefined;
    const prev = kept[kept.length - 1];
    if (isBlank && (kept.length === 0 || (prev && prev.plain.trim() === ''))) return;
    moved.set(i, kept.length);
    kept.push(
      opts.level === 0 ? { ...line, ansi: line.plain.replace(/\s+$/, ''), plain: line.plain.replace(/\s+$/, '') } : line,
    );
  });
  while (kept.length > 0 && kept[kept.length - 1]!.plain.trim() === '') kept.pop();

  const at = (i: number) => moved.get(i) ?? 0;
  const toc = out.toc.map((e) => ({ ...e, line: at(e.line) })).filter((e) => e.line < kept.length);
  const code = out.code
    .map((c) => ({ ...c, from: at(c.from), to: at(c.to) }))
    .filter((c) => c.from < kept.length);

  return { lines: kept, toc, code, width: inner };
}
