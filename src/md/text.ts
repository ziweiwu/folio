import { chopSpans, plainSpans, renderSpans } from '../core/wrap.js';
import type { Doc, LayoutOptions, Line } from '../core/types.js';
import { geometry } from './layout.js';
import { sanitizeSource } from '../core/sanitize.js';
import { displayWidth, widest } from '../core/width.js';

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
 *
 * Which is also why the text column does not apply here. Prose is capped at
 * `maxWidth` because a long measure is hard to read; a patch, a CSV or a source
 * file has no measure to cap — its columns *are* its meaning (I-38) — so it is
 * laid out against the page, exactly as a code block is. Capping it instead
 * reflowed 24 lines of a source file at every terminal size from 88 columns up,
 * while the margin grew without bound: at 400 columns the file was indented 155
 * cells, cut at 88, and 157 columns stood empty. None of those rows were
 * flagged `wide`, so `l` could not reach the tail at any size at all.
 */
export function layoutText(src: string, opts: LayoutOptions): Doc {
  const { left, inner, page } = geometry(opts);
  const { theme, level } = opts;
  const lines: Line[] = [];

  // I-29: same rule as the markdown path — the file does not drive the terminal.
  const source = sanitizeSource(src).replace(/\n+$/, '').split('\n');
  const natural = widest(source, displayWidth);

  /* Scrolling lays the file out whole and lets the viewport pan over it;
     wrapping chops, but at the page rather than at the text column. Either way
     the floor is `inner`, so a narrow file still sits in the text column.
     I-41 again, and the one instance that needs no cap at `natural`, because
     `chopSpans` does not pad a row out to the budget it is given. */
  const wrapWidth = Math.max(inner, page - MARGIN * 2);
  const width = opts.overflow === 'scroll' ? Math.max(inner, natural) : wrapWidth;
  /* What ends up on screen, which is the file's own width until it is chopped.
     `width` is a budget and `chopSpans` never pads to it, so centring on the
     budget would push a narrow file left of where prose sits. */
  const shown = Math.min(natural, width);

  /* Centred on what is shown rather than offset by a margin sized for the text
     column. A source file is as wide as it is: at 400 columns a 176-cell file
     was indented 155 cells and left 68 spare on the right, which is not a
     margin, it is a lean. Capped at the margin prose would get, so a narrow
     file still lines up with the rest of the app, and floored at `MARGIN` so a
     file wider than the page keeps its breathing room. */
  const centred = Math.floor((page - shown) / 2);
  const indent = Math.max(Math.min(left, MARGIN), Math.min(left, centred));

  /* Every row moves together or none does. A file is one thing the reader pans
     across, not a stack of independent blocks — shifting only the long rows
     would slide half a patch out from under the other half. */
  const wide = opts.overflow === 'scroll' && indent + shown > page;
  const margin = ' '.repeat(indent);

  source.forEach((raw, i) => {
    // Tabs were already expanded against real tab stops by `sanitizeSource`.
    const spans = [{ text: raw, style: theme.text }];
    for (const row of chopSpans(spans, width)) {
      const withMargin = [{ text: margin, style: {} }, ...row];
      const plain = plainSpans(withMargin).replace(/\s+$/, '');
      const line: Line = {
        ansi: level === 0 ? plain : renderSpans(withMargin, level),
        plain,
        // One block per source line, so a resize still keeps the reader's place.
        block: i,
      };
      if (wide) line.wide = true;
      lines.push(line);
    }
  });

  return { lines, toc: [], code: [], width };
}

/** Breathing room between the terminal edge and the text, as in `layoutDoc`. */
const MARGIN = 2;

/**
 * Extensions shown verbatim, because markdown is not what they are (I-38).
 *
 * The prose formats were here from the start. The rest — source and config —
 * were not, and every one of them was being parsed as markdown, which does not
 * merely style them wrongly but destroys them: a paragraph is a run of
 * non-blank lines joined with spaces, so a Python file lost every indent it
 * has and came out as one line; `# comment` became a heading; `* item` became
 * a bullet. Indentation is the meaning of the file for most of this list, and
 * a viewer that silently removes it is not showing the file.
 *
 * The set is deliberately a list of what is known rather than a guess: an
 * unknown extension still defaults to markdown, because a file someone points
 * a markdown viewer at usually is one.
 */
const VERBATIM = new Set([
  // Prose that is not markdown.
  '.org', '.txt', '.text', '.log', '.rst', '.adoc', '.asciidoc', '.tex',
  // Source, where indentation and line breaks carry the meaning.
  '.c', '.cc', '.cpp', '.cs', '.cxx', '.dart', '.ex', '.exs', '.go', '.h',
  '.hpp', '.hs', '.java', '.jl', '.kt', '.lua', '.m', '.mm', '.php', '.pl',
  '.py', '.r', '.rb', '.rs', '.scala', '.sql', '.swift', '.vim', '.zig',
  '.js', '.cjs', '.mjs', '.jsx', '.ts', '.cts', '.mts', '.tsx',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  // Config and data.
  '.cfg', '.conf', '.csv', '.env', '.ini', '.json', '.jsonc', '.properties',
  '.toml', '.tsv', '.xml', '.yaml', '.yml',
  // Markup that is its own thing, and patches, which must stay column-exact.
  '.css', '.diff', '.htm', '.html', '.less', '.patch', '.scss', '.svg',
]);

/** Extensionless files that are configuration or build input, not prose. */
const VERBATIM_NAMES = new Set([
  'dockerfile', 'gemfile', 'justfile', 'makefile', 'procfile', 'rakefile', 'vagrantfile',
]);

/**
 * Markdown's own extensions, checked before anything else.
 *
 * They have to win outright rather than merely fall through the sets above,
 * because a *hidden* markdown file is still markdown: `.notes.md` starts with
 * a dot and would otherwise be classified as configuration by the rule below.
 */
const MARKDOWN = new Set(['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdx', '.rmd', '.qmd']);

/**
 * Enough of a file to tell text from bytes.
 *
 * A bounded prefix rather than the whole string: this runs before anything is
 * drawn, and scanning a 40 MB file to learn what its first hundred characters
 * already say would be paid by every reader for the benefit of none. Every
 * binary format carries a NUL in its header, and no UTF-8 text has one
 * anywhere, so the answer is always in the first few bytes. See I-39.
 */
const BINARY_SNIFF = 8192;

/** True for input no viewer can render as a document. See I-39. */
export function looksBinary(text: string): boolean {
  return text.slice(0, BINARY_SNIFF).includes('\u0000');
}

/**
 * Columns of indentation past which a file is not a document.
 *
 * Markdown nests a list one level per indent step, and `marked`'s lexer costs
 * O(depth²) to work out how deep a run of them goes: 800 levels take 125 ms,
 * 1,600 take 891 ms, and 5,000 abort the process with a heap exhaustion that
 * no `try`/`catch` can see, because the whole thing is one synchronous call.
 * A markdown file is untrusted input (I-29) — it arrives from a repository, a
 * download, a pipe — so a crafted one must not be able to kill the viewer.
 *
 * This bound is on indentation, and it is set far above anything a person
 * writes: eight levels of list is already unreadable, and this allows two
 * hundred and fifty-six. Counted in *columns*, because that is the unit
 * markdown nests in and a tab is worth up to four of them — measured against a
 * stack a third of the usual size, 256 tab-indented levels still overflowed
 * while 256 columns of spaces did not, so counting characters was reading the
 * wrong number. See I-40.
 */
const MAX_LIST_INDENT = 256;

/** Where markdown puts its tab stops when it measures an indent. */
const TAB_STOP = 4;

/** What a run of leading whitespace is worth, in columns. */
function indentColumns(whitespace: string): number {
  let columns = 0;
  for (const ch of whitespace) columns += ch === '\t' ? TAB_STOP - (columns % TAB_STOP) : 1;
  return columns;
}

/**
 * Block markers one line may open before the file is not a document.
 *
 * Indentation is not the only thing that nests, which the bound above assumed
 * for as long as it was the only one. A line opens a level per marker it
 * carries, and markers chain along a single line needing no indentation at
 * all: `> > > …`, `1. 1. 1. …` and `> 1. > 1. …` each nest as deep as they are
 * long. The indent bound never saw any of them — its regex captures the
 * leading whitespace, which in all three is empty — so all three reached the
 * parser and overflowed a stack, at 1,060 levels of quotation, 796 of chained
 * list marker, and 904 of the two alternating — all three counted in levels,
 * which is what this bounds. Counted instead in repetitions of the chain, the
 * last of those reads 452 and looks like half the margin it is, because each
 * repetition opens two levels. Quotation overflows
 * this viewer's own layout rather than `marked`'s lexer, because `renderQuote`
 * recurses once per level too; the file that does it is 3 KB.
 *
 * Sixty-four is twelve times below the shallowest of those crashes, measured
 * in the levels this counts rather than in repetitions of a chain that opens
 * two at a time. The margin has to be a measured one, because where a stack
 * ends is a property of the machine and not of the document: on the smallest
 * stack the app can start under at all it narrows to 11.7x, and it cannot be
 * checked below that, because under roughly 700 KB Ink's own WASM fails to
 * load before any document is read. Sixty-four is also far above anything
 * anyone writes — three levels of quotation is already hard to follow.
 */
const MAX_BLOCK_DEPTH = 64;

/**
 * Emphasis delimiters in a row past which a line is not prose.
 *
 * `marked` masks punctuation across the whole inline string before it pairs
 * emphasis up, and one unbroken run of `*` or `_` overflows the stack inside
 * that pass at around five thousand. It has to be a single run of a single
 * character: ten thousand asterisks scattered through a paragraph, or
 * alternating with underscores, both parse fine — so the bound is on the run
 * and not on the count. Two hundred and fifty-six is twenty times below the
 * crash and well above a row of asterisks used as a divider.
 */
const MAX_DELIMITER_RUN = 256;

/** A line that opens a list item, and how far it is indented. */
const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]/;

/**
 * One block marker, and the gap before it, matched where the last one ended.
 *
 * Sticky rather than anchored so a run can be counted in one pass: a loop that
 * re-anchored against the remainder would re-scan what it had already read.
 *
 * The gap is greedy, and the first version of this bounded it at five columns
 * on the reasoning that markdown allows a marker at most four spaces of indent
 * before the content becomes a code block instead. Both halves of that were
 * wrong. The rule is real but it is measured from the *content column of the
 * enclosing container*, not from the start of the line, so three levels of list
 * put a chained run at column six where a bounded gap could not see it at all —
 * every one of the families below walked straight back in behind one wide
 * ordered marker, in a file of 3 KB. And the performance it was bought for does
 * not exist: a sticky match fails once at a fixed position rather than once per
 * position, so a greedy gap backtracks across the line a single time. Measured
 * on a line of 200,000 spaces it costs 0.6 ms, and on 400,000 it costs 1.2 ms —
 * linear, which is what a document is allowed to cost.
 *
 * So this counts every marker on the line and does not ask whether markdown
 * would nest each one. Over-counting is the safe direction: the answer to a
 * line built out of markers is to show the file verbatim, which loses no text,
 * and a line that markdown *would* nest to depth D necessarily carries D
 * markers to open them with. Indentation is the one thing that opens a level
 * without a marker of its own, which is what the bound above is for.
 */
const BLOCK_MARKER = /[ \t]*(?:>|(?:[-*+]|\d{1,9}[.)])[ \t])/y;

/** How many block levels a single line opens. */
function blockDepth(line: string): number {
  BLOCK_MARKER.lastIndex = 0;
  let depth = 0;
  // Every match consumes its marker at least, so this always reaches the end.
  while (BLOCK_MARKER.exec(line) !== null) depth += 1;
  return depth;
}

/** True for a run of `*` or `_` longer than the inline pass survives. */
function runsLongOnDelimiters(line: string): boolean {
  /* A run cannot outlast the line that holds it, and almost every line in a
     real document is shorter than the bound, so the scan below is paid for
     only where a run long enough to matter could exist at all. */
  if (line.length <= MAX_DELIMITER_RUN) return false;

  let previous = '';
  let run = 0;
  for (const ch of line) {
    run = ch === previous ? run + 1 : 1;
    previous = ch;
    if (run > MAX_DELIMITER_RUN && (ch === '*' || ch === '_')) return true;
  }
  return false;
}

/**
 * True for a document built to abort the parser rather than to be read.
 * Shown verbatim instead, which loses no text.
 *
 * A fenced code block containing a line indented past the bound is the one
 * false positive, and it is the right way round: the cost of being wrong here
 * is a file shown as plain text, and the cost of being wrong the other way is
 * the process aborting on a file the reader merely opened. See I-40.
 */
export function tooHostileToParse(src: string): boolean {
  for (const line of src.split('\n')) {
    const indented = LIST_ITEM.exec(line);
    if (indented && indentColumns(indented[1]!) > MAX_LIST_INDENT) return true;
    if (blockDepth(line) > MAX_BLOCK_DEPTH) return true;
    if (runsLongOnDelimiters(line)) return true;
  }
  return false;
}

/**
 * Whether a path should be parsed as markdown.
 *
 * Unknown extensions and stdin default to markdown, because that is what people
 * point this at; only formats known to be something else are shown verbatim.
 *
 * Read from the basename, not the whole path: a directory can carry a dot of
 * its own, and `/etc/nginx.d/README` is a README rather than a file with a
 * `.d/readme` extension.
 */
export function isMarkdownPath(path: string | null): boolean {
  if (path === null) return true;
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  const dot = name.lastIndexOf('.');
  // A leading dot is the file being hidden, not an extension it carries.
  const ext = dot > 0 ? name.slice(dot) : '';

  if (MARKDOWN.has(ext)) return true;
  /* Everything else beginning with a dot is configuration — `.gitignore`,
     `.zshrc`, `.env.local` — where a `#` starts a comment and not a heading.
     Tested on the whole name rather than on the extension, so the second dot
     in `.env.local` does not make it look like an ordinary file. */
  if (name.startsWith('.')) return false;
  if (ext === '') return !VERBATIM_NAMES.has(name); // README, CHANGELOG, and friends
  return !VERBATIM.has(ext);
}
