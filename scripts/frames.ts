/**
 * Compose real frames of the app, for the review page and the screenshots.
 *
 * Both callers go through here so a screenshot can never drift from what the
 * viewer actually draws: the frames are built by the same `composeFrame`,
 * `statusBar` and pane functions the running app uses.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ColorLevel } from '../src/core/ansi.js';
import type { Theme } from '../src/core/types.js';
import { highlightRow } from '../src/core/search.js';
import { findMatches } from '../src/core/search.js';
import { layoutDoc } from '../src/md/layout.js';
import { isMarkdownPath, layoutText } from '../src/md/text.js';
import { collectLanguages, createHighlighter } from '../src/md/highlight.js';
import { composeFrame, sectionAt, statusBar } from '../src/ui/chrome.js';
import { centre, overlayRows } from '../src/ui/overlay.js';
import { helpPane, searchBar, tocPane } from '../src/ui/panes.js';
import { pickTheme } from '../src/ui/theme.js';

export const ROOT = join(import.meta.dirname, '..');
export const HINTS = '/ search   t toc   ? keys   q quit';

export type Spec = {
  id: string;
  file: string;
  cols: number;
  rows: number;
  theme: 'dark' | 'light';
  level: ColorLevel;
  maxWidth?: number;
  lineNumbers?: boolean;
  /** Heading to scroll to, so the frame shows the part worth looking at. */
  scrollTo?: string;
  /** Cells to shift the viewport sideways over wide rows. */
  hOffset?: number;
  /** Highlight the nth link, as the Tab cursor does. */
  selectLink?: number;
  /** Show an overlay over the document. */
  overlay?: 'toc' | 'help';
  /** Show the search prompt, with matches highlighted. */
  search?: string;
};

export async function renderFrame(spec: Spec): Promise<{ rows: string[]; theme: Theme }> {
  const src = readFileSync(join(ROOT, spec.file), 'utf8');
  const theme = pickTheme(spec.theme);
  const markdown = isMarkdownPath(spec.file);
  const hl =
    spec.level === 0 || !markdown ? null : await createHighlighter(theme.shiki, collectLanguages(src));

  const doc = (markdown ? layoutDoc : layoutText)(src, {
    width: spec.cols - 1, // the scrollbar owns the last column
    maxWidth: spec.maxWidth ?? 88,
    theme,
    level: spec.level,
    lineNumbers: spec.lineNumbers ?? false,
    links: 'osc8',
    overflow: 'scroll',
    highlight: hl?.fn,
  });
  hl?.dispose();

  const height = spec.rows - 1; // the status bar owns the last row
  let offset = 0;
  if (spec.scrollTo) {
    const hit = doc.toc.find((t) => t.text === spec.scrollTo);
    if (hit) offset = Math.min(Math.max(0, hit.line - 1), Math.max(0, doc.lines.length - height));
  }

  const matches = spec.search ? findMatches(doc.lines, spec.search) : [];
  if (matches.length > 0) {
    offset = Math.min(Math.max(0, matches[0]!.line - Math.floor(height / 3)),
                      Math.max(0, doc.lines.length - height));
  }

  const links = doc.lines.flatMap((line, row) =>
    (line.links ?? []).map((t) => ({ href: t.href, start: t.start, end: t.end, row })),
  );
  const chosen = spec.selectLink === undefined ? undefined : links[spec.selectLink];

  const decorate =
    chosen || matches.length > 0
      ? (row: string, line: number) => {
          const ranges = matches
            .filter((m) => m.line === line)
            .map((m, i) => ({ start: m.start, end: m.end, style: i === 0 ? theme.matchCurrent : theme.match }));
          if (chosen && chosen.row === line) {
            ranges.push({ start: chosen.start, end: chosen.end, style: theme.matchCurrent, cells: true } as never);
          }
          return ranges.length === 0 ? row : highlightRow(row, doc.lines[line]!.plain, ranges, spec.cols - 1, spec.level);
        }
      : undefined;

  let rows = composeFrame(
    doc,
    { offset, height, total: doc.lines.length, hOffset: spec.hOffset ?? 0 },
    spec.cols, theme, spec.level, decorate,
  );

  if (spec.overlay) {
    const pane = spec.overlay === 'toc'
      ? tocPane(doc, 4, spec.cols, height, theme, spec.level)
      : helpPane(spec.cols, theme, spec.level);
    const at = centre(pane.width, pane.height, spec.cols, height);
    rows = overlayRows(rows, pane.rows, at.top, at.left, spec.cols, spec.level);
  }

  rows.push(
    spec.search
      ? searchBar(spec.search, matches.length, true, spec.cols, theme, spec.level)
      : statusBar(
          {
            name: spec.file.split('/').pop()!,
            section: spec.hOffset ? `↔ ${spec.hOffset}` : sectionAt(doc, offset),
            offset, height, total: doc.lines.length, hints: HINTS,
          },
          spec.cols, theme, spec.level,
        ),
  );

  return { rows, theme };
}
