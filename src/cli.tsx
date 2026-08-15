#!/usr/bin/env node
import { createRequire } from 'node:module';
import { mkdirSync, openSync, readFileSync, statSync, watch as watchFile, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { ReadStream } from 'node:tty';
import { render } from 'ink';
import { ansiWidth, detectColorLevel, paint, sliceAnsi, type ColorLevel } from './core/ansi.js';
import { parseArgs, type Options } from './core/options.js';
import { layoutDoc } from './md/layout.js';
import { isMarkdownPath, layoutText } from './md/text.js';
import { collectLanguages, createHighlighter } from './md/highlight.js';
import { EMPTY, parsePositions, recall, remember, type Positions } from './core/positions.js';
import { sanitizeLine } from './core/sanitize.js';
import { enterScreen, leaveScreen } from './ui/screen.js';
import { pickTheme } from './ui/theme.js';
import { App, type Source } from './app.js';

const VERSION = (createRequire(import.meta.url)('../package.json') as { version: string }).version;

const HELP = `folio — read markdown in your terminal, properly

Usage
  folio [options] [file.md]

  With a terminal on both ends it opens a pager. Piped or redirected it prints
  the rendered document and exits, so it composes with less, head and friends.
  With no file it reads stdin.

  Markdown is parsed. Formats it does not understand — .org, .txt, .rst, .adoc,
  a log — are shown verbatim rather than misread as markdown.

Options
  -w, --width N       Text column width (default 88). 0 fills the terminal.
      --theme NAME    auto, dark or light (default auto)
  -p, --plain         No colour at all. NO_COLOR does the same.
  -n, --line-numbers  Number the lines inside code blocks
      --links MODE    osc8 (clickable, default), ref (numbered footnotes),
                      or plain (the URL after the text)
      --no-pager      Print and exit even on a terminal
      --watch         Re-render when the file changes on disk
      --no-resume     Always open at the top, rather than where you left off
      --wrap          Chop wide code and tables to fit, instead of letting the
                      viewport scroll sideways over them
      --text          Show the file verbatim, with no markup parsing
      --markdown      Parse as markdown even if the extension says otherwise
  -h, --help          Show this help
      --version       Print the version

Keys
  j k ↓ ↑      one line          d u          half a screen
  f b space    a full screen     g G          top, bottom
  h l ← →      sideways, over wide code and tables      0  back to the left
  tab ⇧tab     pick a link       enter        follow it
  backspace    go back           y            copy the code block on screen
  /            search
  n N          next, previous match
  t            contents          r            reload from disk
  ?            all keys          q esc        quit
  wheel        three lines

Examples
  folio README.md          read a file
  cat NOTES.md | folio     read a pipe, still interactive
  folio README.md | cat    plain text, for a script
  folio --watch spec.md    re-render as you edit it

Exit status
  0  success
  1  could not read the file
  2  bad usage — unknown option, or a value that cannot be used

Notes
  Colour follows the terminal's capabilities and NO_COLOR. Syntax highlighting
  loads only the grammars a document actually uses, so opening a file with no
  code blocks costs nothing.
`;

function fail(message: string, code: 1 | 2): never {
  process.stderr.write(`folio: ${message}\n`);
  if (code === 2) process.stderr.write('Try --help.\n');
  process.exit(code);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * A terminal to read keys from, even when stdin is a pipe.
 *
 * `cat notes.md | viewer` hands us the document on stdin, which leaves nothing
 * to take keystrokes from — and raw mode on a pipe throws. Reopening the
 * controlling terminal gets the keyboard back, so piping in a document still
 * opens a real pager. Returns null when there is no controlling terminal, in
 * which case the caller prints instead of paging.
 */
function openControllingTerminal(): NodeJS.ReadStream | null {
  try {
    const fd = openSync('/dev/tty', 'r');
    const stream = new ReadStream(fd) as unknown as NodeJS.ReadStream;
    if (!stream.isTTY) return null;
    return stream;
  } catch {
    return null;
  }
}

function makeSource(text: string, theme: string, level: ColorLevel): Promise<Source> {
  if (level === 0) return Promise.resolve({ text });
  return createHighlighter(theme, collectLanguages(text)).then((hl) => ({
    text,
    highlight: hl?.fn,
  }));
}

function printOneShot(
  source: Source,
  options: Options,
  level: ColorLevel,
  themeName: string,
  markdown: boolean,
): void {
  const layout = markdown ? layoutDoc : layoutText;
  const width = process.stdout.columns || 80;
  const theme = pickTheme(themeName);
  const doc = layout(source.text, {
    width,
    maxWidth: options.maxWidth,
    theme,
    level,
    lineNumbers: options.lineNumbers,
    links: options.links,
    overflow: 'wrap',
    highlight: source.highlight,
  });
  /* The viewport is what guarantees the frame's width in the interactive path;
     one-shot has no viewport, so it clamps here. Without this a table with
     enough columns to defeat the column solver printed rows wider than the
     terminal, straight into a pipe. See I-1, I-26. */
  const cutMark = paint('\u203a', theme.faint, level);
  const fit = (row: string): string =>
    ansiWidth(row) <= width ? row : sliceAnsi(row, 0, Math.max(0, width - 1)) + cutMark;
  process.stdout.write(
    doc.lines.map((l) => fit(l.ansi)).join('\n') + (doc.lines.length > 0 ? '\n' : ''),
  );
}

/**
 * Candidate files for a link target.
 *
 * A markdown link often points at something the filesystem does not spell the
 * same way: `[[Some Note]]` means `Some Note.md`, and `./guide` means either
 * `guide.md` or `guide/index.md`. Trying the obvious spellings is what makes
 * link-following feel like it works, rather than like it needs the exact path.
 */
function candidates(target: string, baseDir: string): string[] {
  const start = isAbsolute(target) ? target : resolve(baseDir, target);
  const hasExtension = /\.[^./\\]+$/.test(start);
  return hasExtension
    ? [start]
    : [start, `${start}.md`, `${start}.markdown`, resolve(start, 'index.md'), resolve(start, 'README.md')];
}

function firstReadable(paths: readonly string[]): string | null {
  for (const path of paths) {
    try {
      if (statSync(path).isFile()) return path;
    } catch {
      // Not there, or not readable. Try the next spelling.
    }
  }
  return null;
}

/** XDG's state directory is the right home for this: it is neither config the
 *  user edits nor a cache that can be regenerated. */
function positionsFile(env: NodeJS.ProcessEnv = process.env): string {
  const base = env.XDG_STATE_HOME && env.XDG_STATE_HOME !== ''
    ? env.XDG_STATE_HOME
    : join(homedir(), '.local', 'state');
  return join(base, 'folio', 'positions.json');
}

function loadPositions(): Positions {
  try {
    return parsePositions(readFileSync(positionsFile(), 'utf8'));
  } catch {
    return EMPTY;
  }
}

function savePositions(store: Positions): void {
  try {
    const file = positionsFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(store));
  } catch {
    // Remembering where you were is a convenience. A read-only home directory
    // is not a reason to fail on the way out.
  }
}

/**
 * A reader that stops reading is not an error.
 *
 * `folio doc.md | head -1` closes the pipe as soon as it has its line, and the
 * write still in flight then fails with EPIPE. Node's default for an unhandled
 * stream error is to throw, so composing with `head` — which this tool
 * advertises — printed a stack trace and exited 1. Downstream leaving early is
 * ordinary Unix behaviour and means the job is done. Any *other* write error is
 * still a real failure and still reported. See I-17, I-32.
 */
function tolerateClosedPipe(): void {
  // Diagnostics are best-effort: stderr can be closed too, and a viewer that
  // dies trying to report that it could not report something is no use.
  process.stderr.on('error', () => {});
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') process.exit(0);
    try {
      process.stderr.write(`folio: ${err.message}\n`);
    } catch {
      // Nothing left to say it to.
    }
    process.exit(1);
  });
}

async function main(): Promise<void> {
  tolerateClosedPipe();
  const parsed = parseArgs(process.argv.slice(2));
  if (!parsed.ok) fail(parsed.message, parsed.code);
  const options = parsed.options;

  if (options.help) {
    process.stdout.write(HELP);
    return;
  }
  if (options.version) {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  let text: string;
  let name: string;
  if (options.file !== null) {
    try {
      text = readFileSync(options.file, 'utf8');
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      fail(
        e.code === 'ENOENT'
          ? `${options.file}: no such file. Check the path, or pass the document on stdin.`
          : `${options.file}: ${e.message}`,
        1,
      );
    }
    /* A file can be *named* with an escape sequence, and the status bar
       prints the name it is given. See I-29. */
    name = sanitizeLine(basename(options.file));
  } else if (!process.stdin.isTTY) {
    text = await readStdin();
    name = 'stdin';
  } else {
    fail('no file given, and stdin is a terminal. Pass a file, or pipe one in.', 2);
  }

  /* Colour is off when writing to a pipe, so `viewer x.md | cat` stays clean;
     FORCE_COLOR overrides that for `| less -R`. See I-11. */
  const markdown = options.markdown ?? isMarkdownPath(options.file);

  const wantsColor = process.stdout.isTTY || (process.env.FORCE_COLOR ?? '') !== '';
  const level: ColorLevel = options.plain || !wantsColor ? 0 : detectColorLevel();
  const theme = pickTheme(options.theme);

  /* No TUI unless both ends are terminals — the hard rule from every TUI that
     ever crashed in a cron job. When stdin is a pipe we can still page, but
     only by borrowing the controlling terminal for input. See I-8, I-12. */
  const input = process.stdin.isTTY ? process.stdin : openControllingTerminal();
  const interactive = options.pager && process.stdout.isTTY === true && input !== null;

  if (!interactive) {
    // One-shot has one chance to get it right, so it waits for highlighting.
    printOneShot(await makeSource(text, theme.shiki, level), options, level, options.theme, markdown);
    return;
  }

  const reload = options.file === null
    ? undefined
    : async (): Promise<Source> => makeSource(readFileSync(options.file!, 'utf8'), theme.shiki, level);

  const watch = options.watch && options.file !== null
    ? (onChange: () => void) => {
        const watcher = watchFile(options.file!, { persistent: false }, () => onChange());
        return () => watcher.close();
      }
    : undefined;

  // Nothing to highlight in a file shown verbatim.
  const upgrade = level === 0 || !markdown ? undefined : () => makeSource(text, theme.shiki, level);
  /* The base directory follows navigation: after opening a link, the next
     relative link is relative to *that* file, not to the one we started on. */
  let currentDir = options.file === null ? null : dirname(resolve(options.file));

  const openRelative = currentDir === null
    ? undefined
    : async (target: string) => {
        const found = firstReadable(candidates(target, currentDir!));
        if (found === null) return null;
        /* `stat` succeeding does not mean the file can be read — a mode-000
           file stats perfectly well. Nothing below this line runs unless the
           read worked, so a failure leaves the viewer exactly where it was. */
        const body = readFileSync(found, 'utf8');
        const asMarkdown = options.markdown ?? isMarkdownPath(found);
        if (currentFile !== null) {
          positions.entries[currentFile] = { block: currentBlock, at: Date.now() };
        }
        currentDir = dirname(found);
        currentFile = found;
        currentBlock = 0;
        return {
          source: asMarkdown ? await makeSource(body, theme.shiki, level) : { text: body },
          name: sanitizeLine(basename(found)),
          markdown: asMarkdown,
        };
      };

  /* Position is reported continuously into a local, and written once on the
     way out — a file write per scroll would be absurd. */
  let currentFile = options.file === null ? null : resolve(options.file);
  let currentBlock = 0;
  const positions = options.resume && currentFile !== null ? loadPositions() : EMPTY;
  const startBlock = currentFile === null ? null : recall(positions, currentFile);

  const mouse = level > 0;
  enterScreen(process.stdout, mouse);
  try {
    const app = render(
      <App
        initial={{ text }}
        name={name}
        options={options}
        theme={theme}
        level={level}
        mouse={mouse}
        reload={reload}
        watch={watch}
        upgrade={upgrade}
        markdown={markdown}
        overflow={options.wrap ? 'wrap' : 'scroll'}
        open={openRelative}
        startBlock={startBlock}
        onPosition={(block) => {
          currentBlock = block;
        }}
      />,
      { stdin: input, stdout: process.stdout, exitOnCtrlC: false, patchConsole: true },
    );
    await app.waitUntilExit();
    if (options.resume && currentFile !== null) {
      savePositions(remember(positions, currentFile, currentBlock, Date.now()));
    }
  } finally {
    leaveScreen();
  }
}

await main();
