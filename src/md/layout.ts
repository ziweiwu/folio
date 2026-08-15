import type { Token, Tokens } from 'marked';
import type { Style } from '../core/ansi.js';
import { linkRanges, padSpans, plainSpans, renderSpans, spansWidth, wrapSpans } from '../core/wrap.js';
import type { CodeBlock, Doc, HeadingRef, LayoutOptions, Line, Span, TocEntry } from '../core/types.js';
import { inlineSpans, type InlineContext } from './inline.js';
import { layoutCode } from './code.js';
import { layoutTable } from './tables.js';
import { parseMarkdown, type FrontMatter } from './parse.js';
import { displayWidth, truncate } from '../core/width.js';
import { sanitizeSource } from '../core/sanitize.js';

/** Breathing room between the terminal edge and the text column. */
const MARGIN = 2;
/** Below this the text column stops being worth centring. */
const MIN_INNER = 20;

const BULLETS = ['•', '◦', '▪', '·'];

type Out = { lines: Line[]; toc: TocEntry[]; code: CodeBlock[]; block: number };

type Ctx = {
  out: Out;
  opts: LayoutOptions;
  ictx: InlineContext;
  left: number;
  inner: number;
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

export function geometry(opts: LayoutOptions): { left: number; inner: number } {
  const total = Math.max(MIN_INNER, opts.width);
  let inner = opts.maxWidth > 0 ? Math.min(total - MARGIN * 2, opts.maxWidth) : total - MARGIN * 2;
  if (inner < MIN_INNER) inner = Math.max(1, total - 2);
  return { left: Math.max(1, Math.floor((total - inner) / 2)), inner };
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
      const block = layoutCode(tok.text, tok.lang ?? '', available(ctx), ctx.opts);
      const from = ctx.out.lines.length;
      for (const row of block.lines) emitRaw(ctx, row, undefined, block.wide);
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
      const table = layoutTable(t as Tokens.Table, available(ctx), ctx.opts, ctx.ictx);
      for (const row of table.lines) emitRaw(ctx, row, undefined, table.wide);
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
  const keyWidth = Math.min(20, Math.max(...fm.map(([k]) => displayWidth(k))));
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
  const { left, inner } = geometry(opts);
  const out: Out = { lines: [], toc: [], code: [], block: 0 };
  const ictx: InlineContext = { theme: opts.theme, links: opts.links, refs: [] };
  const ctx: Ctx = {
    out,
    opts,
    ictx,
    left,
    inner,
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
