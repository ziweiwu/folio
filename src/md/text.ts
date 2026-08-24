import { chopSpans, plainSpans, renderSpans } from '../core/wrap.js';
import type { Doc, LayoutOptions, Line } from '../core/types.js';
import { geometry } from './layout.js';
import { sanitizeSource } from '../core/sanitize.js';

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

  // I-29: same rule as the markdown path — the file does not drive the terminal.
  sanitizeSource(src).replace(/\n+$/, '').split('\n').forEach((raw, i) => {
    // Tabs were already expanded against real tab stops by `sanitizeSource`.
    const spans = [{ text: raw, style: theme.text }];
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
 * Levels of list nesting past which a file is not a document.
 *
 * Markdown nests a list one level per indent step, and `marked`'s lexer costs
 * O(depth²) to work out how deep a run of them goes: 800 levels take 125 ms,
 * 1,600 take 891 ms, and 5,000 abort the process with a heap exhaustion that
 * no `try`/`catch` can see, because the whole thing is one synchronous call.
 * A markdown file is untrusted input (I-29) — it arrives from a repository, a
 * download, a pipe — so a crafted one must not be able to kill the viewer.
 *
 * The bound is on indentation because that is what drives the nesting, and it
 * is set far above anything a person writes: eight levels of list is already
 * unreadable, and this allows two hundred and fifty-six. See I-40.
 */
const MAX_LIST_INDENT = 256;

/** A line that opens a list item, and how far it is indented. */
const LIST_ITEM = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]/;

/**
 * True for a document whose list nesting is deep enough to be an attack
 * rather than a document. Shown verbatim instead, which loses no text.
 *
 * A fenced code block containing a line indented past the bound is the one
 * false positive, and it is the right way round: the cost of being wrong here
 * is a file shown as plain text, and the cost of being wrong the other way is
 * the process aborting on a file the reader merely opened. See I-40.
 */
export function nestsTooDeeply(src: string): boolean {
  for (const line of src.split('\n')) {
    const m = LIST_ITEM.exec(line);
    if (m && m[1]!.length > MAX_LIST_INDENT) return true;
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
