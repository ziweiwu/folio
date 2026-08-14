#!/usr/bin/env tsx
/**
 * Render real frames and write a review page.
 *
 * This is the UX sign-off gate: the frames below are the app's actual output,
 * composed by the same functions the TUI uses, so approving them approves the
 * thing that will ship.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutDoc } from '../src/md/layout.js';
import { isMarkdownPath, layoutText } from '../src/md/text.js';
import { collectLanguages, createHighlighter } from '../src/md/highlight.js';
import { composeFrame, sectionAt, statusBar } from '../src/ui/chrome.js';
import { highlightRow } from '../src/core/search.js';
import { pickTheme } from '../src/ui/theme.js';
import type { ColorLevel } from '../src/core/ansi.js';
import { ansiToHtml } from './ansi-to-html.js';

const ROOT = join(import.meta.dirname, '..');
const HINTS = 'j/k scroll   / search   t toc   ? help   q quit';

type Spec = {
  id: string;
  title: string;
  note: string;
  command: string;
  file: string;
  cols: number;
  rows: number;
  theme: 'dark' | 'light';
  level: ColorLevel;
  maxWidth?: number;
  lineNumbers?: boolean;
  /** Heading to scroll to, so the frame shows the part worth reviewing. */
  scrollTo?: string;
  /** Cells to shift the viewport sideways over wide rows. */
  hOffset?: number;
  /** Highlight the nth link, as the Tab cursor does. */
  selectLink?: number;
};

const SPECS: Spec[] = [
  {
    id: 'opening',
    title: 'Opening a document',
    note: 'Front matter becomes a metadata header instead of a stray code block. The H1 band and the centred 88-column text column set the page rhythm.',
    command: 'folio kitchen-sink.md',
    file: 'test/fixtures/kitchen-sink.md',
    cols: 100, rows: 32, theme: 'dark', level: 3,
  },
  {
    id: 'code',
    title: 'Code, highlighted',
    note: 'Shiki tokens on a continuous background band. Keyword, type, function name and string are all distinct — the reason for taking the dependency.',
    command: 'folio kitchen-sink.md',
    file: 'test/fixtures/kitchen-sink.md',
    cols: 100, rows: 32, theme: 'dark', level: 3, scrollTo: 'Code',
  },
  {
    id: 'linenumbers',
    title: 'Line numbers',
    note: 'With --line-numbers. The gutter stays inside the frame and continuation rows leave it blank, so numbers still read one-per-source-line.',
    command: 'folio kitchen-sink.md --line-numbers',
    file: 'test/fixtures/kitchen-sink.md',
    cols: 100, rows: 26, theme: 'dark', level: 3, scrollTo: 'Code', lineNumbers: true,
  },
  {
    id: 'tables',
    title: 'Tables and quotes',
    note: 'Columns are solved shrink-largest-first, so the prose column loses cells before the numbers do. Quote bars continue through blank rows and deepen when nested.',
    command: 'folio kitchen-sink.md',
    file: 'test/fixtures/kitchen-sink.md',
    cols: 100, rows: 32, theme: 'dark', level: 3, scrollTo: 'Tables',
  },
  {
    id: 'light',
    title: 'Light theme',
    note: 'Same document, --theme light. Picked automatically from COLORFGBG when the terminal reports it.',
    command: 'folio kitchen-sink.md --theme light',
    file: 'test/fixtures/kitchen-sink.md',
    cols: 100, rows: 30, theme: 'light', level: 3,
  },
  {
    id: 'narrow',
    title: 'A narrow terminal',
    note: 'Sixty-four columns. The text column stops centring and gives its margins back; code frames and tables reflow rather than overflow.',
    command: 'folio kitchen-sink.md   # in a 64-column window',
    file: 'test/fixtures/kitchen-sink.md',
    cols: 64, rows: 30, theme: 'dark', level: 3, scrollTo: 'Code',
  },
  {
    id: 'wide',
    title: 'Wide characters',
    note: 'Every CJK glyph and emoji is two cells. The table rules line up with its rows — which is the whole test.',
    command: 'folio wide-chars.md',
    file: 'test/fixtures/wide-chars.md',
    cols: 100, rows: 28, theme: 'dark', level: 3,
  },
  {
    id: 'nesting',
    title: 'Deep nesting',
    note: 'Lists in quotes in lists. Indentation sits outside a quote bar it contains, and the bar sits outside a list the quote contains, at any depth.',
    command: 'folio nesting.md',
    file: 'test/fixtures/nesting.md',
    cols: 100, rows: 32, theme: 'dark', level: 3,
  },
  {
    id: 'wide',
    title: 'Wide content, at rest',
    note: 'The command and the table are laid out at their natural width. A › at the right edge says the row continues past the screen — nothing has been chopped or truncated.',
    command: 'folio wide.md',
    file: 'test/fixtures/wide.md',
    cols: 84, rows: 20, theme: 'dark', level: 3,
  },
  {
    id: 'scrolled',
    title: 'The same frame, scrolled sideways',
    note: 'After pressing l a few times. Only the wide rows moved: the paragraph above them is exactly where it was, so you keep the sentence that explains the command you are reading.',
    command: 'folio wide.md   # then l l l l l',
    file: 'test/fixtures/wide.md',
    cols: 84, rows: 20, theme: 'dark', level: 3, hOffset: 40,
  },
  {
    id: 'links',
    title: 'Following a link',
    note: 'Tab moves the cursor to the next link and scrolls it into view; Enter opens it. Relative paths, #anchors and [[wikilinks]] all resolve; Backspace walks back.',
    command: 'folio wiki/index.md   # then tab tab',
    file: 'test/fixtures/wiki/index.md',
    cols: 84, rows: 20, theme: 'dark', level: 3, selectLink: 1,
  },
  {
    id: 'org',
    title: 'A format it does not parse',
    note: 'Org, shown verbatim. Its * headings are not emphasis and its #+BEGIN_SRC is not a fence, so parsing it as markdown would misrepresent the file. Wrapping to the terminal is the only thing applied.',
    command: 'folio sample.org',
    file: 'test/fixtures/sample.org',
    cols: 90, rows: 26, theme: 'dark', level: 3,
  },
  {
    id: 'plain',
    title: 'No colour at all',
    note: 'NO_COLOR=1. Structure survives without hue: headings keep their rules, tasks keep their boxes, code keeps its frame.',
    command: 'NO_COLOR=1 folio kitchen-sink.md',
    file: 'test/fixtures/kitchen-sink.md',
    cols: 84, rows: 28, theme: 'dark', level: 0,
  },
];

const GROUND = {
  dark: { fg: '#c0caf5', bg: '#1a1b26' },
  light: { fg: '#24292f', bg: '#ffffff' },
};

async function renderSpec(spec: Spec): Promise<string> {
  const src = readFileSync(join(ROOT, spec.file), 'utf8');
  const theme = pickTheme(spec.theme);
  const hl = spec.level === 0 ? null : await createHighlighter(theme.shiki, collectLanguages(src));

  const doc = (isMarkdownPath(spec.file) ? layoutDoc : layoutText)(src, {
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

  const state = { offset, height, total: doc.lines.length, hOffset: spec.hOffset ?? 0 };

  /* The link cursor is the app's own highlight, applied through the same
     decorate hook the viewer uses, so the specimen shows the real thing. */
  const links = doc.lines.flatMap((line, row) =>
    (line.links ?? []).map((t) => ({ href: t.href, start: t.start, end: t.end, row })),
  );
  const chosen = spec.selectLink === undefined ? undefined : links[spec.selectLink];
  const decorate = chosen
    ? (row: string, line: number) =>
        line === chosen.row
          ? highlightRow(row, doc.lines[line]!.plain,
              [{ start: chosen.start, end: chosen.end, style: theme.matchCurrent, cells: true }],
              spec.cols - 1, spec.level)
          : row
    : undefined;

  const rows = composeFrame(doc, state, spec.cols, theme, spec.level, decorate);
  rows.push(
    statusBar(
      {
        name: spec.file.split('/').pop()!,
        section: sectionAt(doc, offset),
        offset, height,
        total: doc.lines.length,
        hints: HINTS,
      },
      spec.cols, theme, spec.level,
    ),
  );

  return ansiToHtml(rows, GROUND[spec.theme]);
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const CSS = `
:root {
  --ground: #f5f6fa;
  --surface: #ffffff;
  --ink: #1a1e2c;
  --muted: #58607a;
  --faint: #8b93a8;
  --rule: #e1e4ee;
  --accent: #3a68d8;
  --accent-soft: #e9effc;
  --shadow: 0 1px 2px rgba(20, 26, 46, .05), 0 10px 28px -14px rgba(20, 26, 46, .22);
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  --serif: "Iowan Old Style", Charter, "Bitstream Charter", Georgia, serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --ground: #0d0f16;
    --surface: #151824;
    --ink: #d5dbef;
    --muted: #8f98b2;
    --faint: #6a7288;
    --rule: #242938;
    --accent: #7aa2f7;
    --accent-soft: #1a2340;
    --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 14px 34px -16px rgba(0, 0, 0, .8);
  }
}
:root[data-theme="dark"] {
  --ground: #0d0f16;
  --surface: #151824;
  --ink: #d5dbef;
  --muted: #8f98b2;
  --faint: #6a7288;
  --rule: #242938;
  --accent: #7aa2f7;
  --accent-soft: #1a2340;
  --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 14px 34px -16px rgba(0, 0, 0, .8);
}

body {
  background: var(--ground);
  color: var(--ink);
  font-family: var(--serif);
  font-size: 17px;
  line-height: 1.65;
  -webkit-font-smoothing: antialiased;
}

.wrap {
  max-width: 78rem;
  margin: 0 auto;
  padding: 4rem 1.5rem 6rem;
  display: flex;
  flex-direction: column;
  gap: 3.5rem;
}

.masthead { display: flex; flex-direction: column; gap: 1rem; max-width: 62ch; }
.eyebrow {
  font-family: var(--mono);
  font-size: .72rem;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--accent);
}
h1 {
  font-family: var(--mono);
  font-size: clamp(1.7rem, 4vw, 2.5rem);
  font-weight: 600;
  letter-spacing: -.02em;
  line-height: 1.15;
  text-wrap: balance;
}
.lede { color: var(--muted); font-size: 1.12rem; text-wrap: pretty; }

.checklist {
  border: 1px solid var(--rule);
  background: var(--surface);
  border-radius: 10px;
  padding: 1.5rem 1.75rem;
  display: flex;
  flex-direction: column;
  gap: .7rem;
  max-width: 62ch;
  box-shadow: var(--shadow);
}
.checklist h2 {
  font-family: var(--mono);
  font-size: .72rem;
  letter-spacing: .16em;
  text-transform: uppercase;
  color: var(--faint);
  font-weight: 600;
}
.checklist ul { list-style: none; display: flex; flex-direction: column; gap: .55rem; }
.checklist li { display: flex; gap: .75rem; align-items: baseline; color: var(--muted); }
.checklist li::before {
  content: "";
  flex: none;
  width: .5rem; height: .5rem;
  border-radius: 2px;
  background: var(--accent);
  opacity: .55;
  transform: translateY(-.1em);
}

.specimen { display: flex; flex-direction: column; gap: 1rem; }
.specimen header { display: flex; flex-direction: column; gap: .5rem; max-width: 68ch; }
.specimen h2 {
  font-family: var(--mono);
  font-size: 1.05rem;
  font-weight: 600;
  letter-spacing: -.01em;
}
.specimen p { color: var(--muted); font-size: 1rem; text-wrap: pretty; }

.command {
  font-family: var(--mono);
  font-size: .8rem;
  color: var(--faint);
  display: flex;
  gap: .6rem;
  align-items: baseline;
  overflow-x: auto;
  white-space: pre;
  padding-bottom: .15rem;
}
.command::before { content: "$"; color: var(--accent); flex: none; }

.frame {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid var(--rule);
  box-shadow: var(--shadow);
}
.frame .chrome {
  display: flex;
  gap: .4rem;
  padding: .6rem .75rem;
  border-bottom: 1px solid rgba(127, 127, 127, .18);
}
.frame .chrome i { width: .62rem; height: .62rem; border-radius: 50%; background: currentColor; opacity: .35; }
.frame .screen { overflow-x: auto; padding: .85rem 0; }
.frame pre {
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.42;
  padding: 0 .85rem;
  width: max-content;
  min-width: 100%;
  tab-size: 4;
}
.frame.dark { background: #1a1b26; color: #c0caf5; }
.frame.dark .chrome { background: #16161e; }
.frame.light { background: #ffffff; color: #24292f; }
.frame.light .chrome { background: #f3f5f8; }

.note {
  font-family: var(--mono);
  font-size: .74rem;
  color: var(--faint);
  letter-spacing: .01em;
}

footer {
  border-top: 1px solid var(--rule);
  padding-top: 1.5rem;
  color: var(--faint);
  font-family: var(--mono);
  font-size: .78rem;
  max-width: 62ch;
}
footer a { color: var(--accent); }
`;

function page(sections: string): string {
  return `<title>Folio Specimen</title>
<style>${CSS}</style>
<div class="wrap">
  <div class="masthead">
    <div class="eyebrow">folio &middot; design review</div>
    <h1>How the reader looks</h1>
    <p class="lede">Every frame below is real output, composed by the same layout and chrome
    functions the viewer itself calls. Nothing here is a mock-up, so approving these frames
    approves what ships. The scrolling, search and table of contents come next &mdash; this
    round is about typography and colour.</p>
  </div>

  <section class="checklist">
    <h2>Worth a second look</h2>
    <ul>
      <li>The 88-column text measure, and whether prose should be allowed wider on a big screen.</li>
      <li>Heading hierarchy: a filled band for H1, a rule for H2, hash markers below that.</li>
      <li>Code frames &mdash; rounded box with a language label, versus a plainer left gutter bar.</li>
      <li>Accent blue reused for headings, bullets, quote bars, scrollbar and status bar.</li>
      <li>The status bar: filename, position, and the section you are currently inside.</li>
      <li>Showing unparsed formats verbatim, rather than misreading them as markdown.</li>
      <li>Whether only the wide rows should move when scrolling sideways, or the whole frame.</li>
      <li>The link cursor: same highlight as a search hit, or something of its own?</li>
    </ul>
  </section>

${sections}

  <footer>
    Generated by <code>npm run preview:html</code> from the fixtures in <code>test/fixtures/</code>.
    Re-run it after any change to the layout engine and the page updates in place.
  </footer>
</div>
`;
}

const parts: string[] = [];
for (const spec of SPECS) {
  const html = await renderSpec(spec);
  parts.push(
    `  <section class="specimen" id="${spec.id}">
    <header>
      <h2>${escapeHtml(spec.title)}</h2>
      <p>${escapeHtml(spec.note)}</p>
    </header>
    <div class="command">${escapeHtml(spec.command)}</div>
    <div class="frame ${spec.theme}">
      <div class="chrome"><i></i><i></i><i></i></div>
      <div class="screen"><pre>${html}</pre></div>
    </div>
    <div class="note">${spec.cols} &times; ${spec.rows} cells &middot; ${spec.level === 0 ? 'no colour' : '24-bit colour'} &middot; ${spec.theme} theme${spec.hOffset ? ` &middot; shifted ${spec.hOffset} cells` : ''}</div>
  </section>`,
  );
}

const out = join(ROOT, 'docs/preview.html');
writeFileSync(out, page(parts.join('\n\n')));
console.error(`wrote ${out} (${(Buffer.byteLength(page(parts.join('\n\n'))) / 1024).toFixed(0)} KB)`);
