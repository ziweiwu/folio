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
export const HINTS = ['/ search', 't toc', '? keys', 'q quit'];

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

/**
 * The frames the README ships as `docs/*.png`.
 *
 * They live here rather than in gen-png.ts so the rasteriser and the freshness
 * check cannot disagree about what a screenshot is meant to show.
 */
export const SHOTS: Spec[] = [
  { id: 'hero', file: 'test/fixtures/kitchen-sink.md', cols: 92, rows: 30, theme: 'dark', level: 3 },
  { id: 'code', file: 'test/fixtures/kitchen-sink.md', cols: 92, rows: 26, theme: 'dark', level: 3, scrollTo: 'Code' },
  { id: 'search', file: 'test/fixtures/kitchen-sink.md', cols: 92, rows: 22, theme: 'dark', level: 3, search: 'scroll' },
  { id: 'contents', file: 'test/fixtures/kitchen-sink.md', cols: 92, rows: 24, theme: 'dark', level: 3, overlay: 'toc' },
  { id: 'wide', file: 'test/fixtures/wide.md', cols: 92, rows: 18, theme: 'dark', level: 3, hOffset: 40 },
  { id: 'light', file: 'test/fixtures/kitchen-sink.md', cols: 92, rows: 26, theme: 'light', level: 3, scrollTo: 'Tables' },
];

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
      : helpPane(spec.cols, height, theme, spec.level);
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

/**
 * A digest of every shipped frame, as the app draws it right now.
 *
 * The PNG bytes cannot be diffed across machines -- font rasterisation differs
 * between a laptop and a CI runner, so a byte comparison cries wolf. The frames
 * underneath them are plain ANSI produced by the app's own compose functions,
 * and those are deterministic. Hashing them catches the thing that actually
 * matters: rendering changed and the screenshots were not regenerated.
 */
export async function digestFrames(frames: { id: string; rows: string[] }[]): Promise<string> {
  const { createHash } = await import('node:crypto');
  const hash = createHash('sha256');
  for (const { id, rows } of frames) hash.update(id + '\u0000' + rows.join('\n') + '\u0000');
  return hash.digest('hex');
}

export async function framesDigest(): Promise<string> {
  const frames: { id: string; rows: string[] }[] = [];
  for (const spec of SHOTS) frames.push({ id: spec.id, rows: (await renderFrame(spec)).rows });
  return digestFrames(frames);
}
