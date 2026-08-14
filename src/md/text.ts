import { chopSpans, plainSpans, renderSpans } from '../core/wrap.js';
import type { Doc, LayoutOptions, Line } from '../core/types.js';
import { geometry } from './layout.js';

/**
 * Render a file as plain text, with no markup interpretation at all.
 *
 * Used for formats this viewer does not understand — `.org`, `.txt`, a log.
 * Reading them through the markdown parser is worse than not parsing them:
 * Org's `*` headings become emphasis, its `#+TITLE:` lines become nothing, and
 * the result misrepresents the file. Showing the file as it is, wrapped to the
 * terminal and nothing more, is honest and still useful.
 *
 * Lines are chopped rather than word-wrapped and blank lines are preserved
 * exactly, because in a plain-text file the author's own layout is the layout.
 */
export function layoutText(src: string, opts: LayoutOptions): Doc {
  const { left, inner } = geometry(opts);
  const { theme, level } = opts;
  const margin = ' '.repeat(left);
  const lines: Line[] = [];

  src.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n').forEach((raw, i) => {
    const spans = [{ text: raw.replace(/\t/g, '    '), style: theme.text }];
    for (const row of chopSpans(spans, inner)) {
      const withMargin = [{ text: margin, style: {} }, ...row];
      const plain = plainSpans(withMargin).replace(/\s+$/, '');
      lines.push({
        ansi: level === 0 ? plain : renderSpans(withMargin, level),
        plain,
        // One block per source line, so a resize still keeps the reader's place.
        block: i,
      });
    }
  });

  return { lines, toc: [], code: [], width: inner };
}

/** Extensions this viewer parses as markdown. */
const MARKDOWN = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx', '.rmd', '.qmd']);
/** Extensions it deliberately shows verbatim. */
const VERBATIM = new Set(['.org', '.txt', '.text', '.log', '.rst', '.adoc', '.asciidoc']);

/**
 * Whether a path should be parsed as markdown.
 *
 * Unknown extensions and stdin default to markdown, because that is what people
 * point this at; only formats known to be something else are shown verbatim.
 */
export function isMarkdownPath(path: string | null): boolean {
  if (path === null) return true;
  const dot = path.lastIndexOf('.');
  if (dot <= 0) return true; // README, CHANGELOG, and friends
  const ext = path.slice(dot).toLowerCase();
  if (VERBATIM.has(ext)) return false;
  return MARKDOWN.has(ext) || true;
}
