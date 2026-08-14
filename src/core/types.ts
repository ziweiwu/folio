import type { ColorLevel, Style } from './ansi.js';

/**
 * One rendered row of the document.
 *
 * The whole design rests on this being computed once per (source, width, theme)
 * and never recomputed while scrolling. See I-3 and I-4.
 */
export type Line = {
  /** Fully styled, at most `width` display cells. */
  ansi: string;
  /** The same row unstyled — used for search, piping and NO_COLOR. */
  plain: string;
  /** Set on the first row of a heading, which is what the TOC lists. */
  heading?: HeadingRef;
  /** Index of the source block, so a resize can re-anchor to it. See I-6. */
  block: number;
  /**
   * True for a row laid out at its natural width rather than wrapped to the
   * text column — code and tables, in `scroll` overflow. Only these rows move
   * when the viewport is scrolled sideways, so prose stays where it was read.
   */
  wide?: boolean;
  /** Link targets on this row, positioned in display cells. */
  links?: LinkTarget[];
};

/** A followable link, with the cells it occupies on its row. */
export type LinkTarget = { href: string; start: number; end: number };

/** A fenced code block, kept so it can be copied verbatim. */
export type CodeBlock = {
  /** First and last row of the block's frame, inclusive. */
  from: number;
  to: number;
  lang: string;
  code: string;
};

export type HeadingRef = { level: number; text: string };

export type TocEntry = HeadingRef & { line: number };

export type Doc = {
  lines: Line[];
  toc: TocEntry[];
  code: CodeBlock[];
  /** The width this document was laid out for. */
  width: number;
};

export type LinkMode = 'osc8' | 'ref' | 'plain';

export type Theme = {
  name: string;
  /** Name of the Shiki theme used for code blocks. */
  shiki: string;

  text: Style;
  muted: Style;
  faint: Style;

  h1: Style;
  h2: Style;
  h3: Style;
  h4: Style;
  headingRule: Style;

  strong: Style;
  em: Style;
  strike: Style;

  link: Style;
  linkUrl: Style;

  codeBg: string;
  codeText: Style;
  codeLabel: Style;
  codeGutter: Style;
  inlineCode: Style;

  quoteBar: Style;
  quoteText: Style;

  listMarker: Style;
  taskDone: Style;
  taskTodo: Style;

  tableBorder: Style;
  tableHeader: Style;

  rule: Style;
  image: Style;
  frontMatterKey: Style;
  frontMatterValue: Style;

  status: Style;
  statusAccent: Style;
  statusMuted: Style;

  scrollTrack: Style;
  scrollThumb: Style;

  match: Style;
  matchCurrent: Style;

  overlayBg: string;
  overlayText: Style;
  overlayTitle: Style;
};

export type LayoutOptions = {
  /** Total cells available to document rows (terminal columns minus gutters). */
  width: number;
  /** Cap on the text column; 0 fills the terminal. */
  maxWidth: number;
  theme: Theme;
  level: ColorLevel;
  lineNumbers: boolean;
  links: LinkMode;
  /**
   * What to do with content too wide for the text column.
   *
   * `wrap` chops it to fit, which is right for piped output that nobody can
   * scroll. `scroll` lays it out at its natural width and lets the viewport
   * shift sideways, which is truer to the source.
   */
  overflow: 'wrap' | 'scroll';
  /** Injected so layout stays synchronous and pure. See `md/highlight.ts`. */
  highlight?: HighlightFn;
};

/** Code text and a language, in; one styled string per line, out. */
export type HighlightFn = (code: string, lang: string) => Span[][] | null;

/** A run of text sharing one style. Inline markdown is laid out as spans, then
 *  wrapped, then painted — wrapping styled text is far easier before it becomes
 *  an ANSI string than after. */
export type Span = { text: string; style: Style; link?: string };
