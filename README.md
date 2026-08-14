# folio

[![ci](https://github.com/ziweiwu/folio/actions/workflows/ci.yml/badge.svg)](https://github.com/ziweiwu/folio/actions/workflows/ci.yml)

Read markdown in your terminal, properly. Real typography, real syntax
highlighting, and scrolling that keeps up with your keyboard.

```sh
npm install -g @ziweiwu/folio
folio README.md
```

## Design philosophy

Three things, in this order, whenever they conflict.

**Simplicity.** seven runtime dependencies, no configuration file, no plugin
system, no stash. It opens a file and shows it to you. The keys are vim's,
because you already know them.

**Clarity.** The document should read the way a well-set page reads: an 88-column
text measure, hanging indents, real hierarchy, colour used as a redundant signal
and never the only one. `NO_COLOR` output is fully legible — headings keep their
rules, tasks keep their boxes, code keeps its frame.

**Speed.** Layout runs once per document, not once per scroll. Everything after
that is an array slice. Opening a file never waits for syntax highlighting.

## Why not glow

|  | glow | this |
|---|---|---|
| Scrolling a long file | re-renders the document each scroll | lays out once, then slices |
| Cost per frame | grows with the document | **0.10 ms** on a 6,246-row document |
| A held key | queues renders and falls behind | coalesced to one update per frame |
| Resize | loses your place | re-anchors to the block you were reading |
| Position | a percentage | percentage **and** the section you are inside |
| Wide code | folds it | scrolls sideways over it |
| Links | not followable | Tab to pick, Enter to open, Backspace to go back |
| Wikilinks | no | `[[target\|label]]` and `[[target#heading]]` |
| Reopening a file | at the top | where you left off |
| Highlighting | Chroma | Shiki — the grammars and themes VS Code uses |
| Wide characters | `String.length` in places | display cells throughout, property-tested |

## Keys

```
j k ↓ ↑      one line              d u          half a screen
f b space    a full screen         g G          top, bottom
h l ← →      sideways              0            back to the left edge
wheel        three lines

tab ⇧tab     pick a link           enter        follow it
backspace    go back               y            copy the code block on screen
/            search                n N          next, previous match
t            contents              r            reload from disk
?            all keys              q esc        quit
```

Search is smartcase: lowercase matches anything, a capital means you meant it.
A hit lands a third of the way down the screen rather than at the very top, so
there is context above it.

**Wide content scrolls, it doesn't get chopped.** A long command or a wide table
is laid out at its natural width and the viewport moves over it, with `‹` and `›`
at whichever edge continues. Only those rows move — the prose around them stays
where you were reading it. `--wrap` gives you the folding behaviour instead.

**Links go somewhere.** `Tab` picks the next link and scrolls it into view,
`Enter` follows it. A relative path opens that file, `#anchors` jump to the
heading, and `Backspace` walks back. `[[Wikilinks]]`, `[[target|label]]` and
`[[target#heading]]` work too, so an Obsidian or Foam vault reads properly.
External URLs are shown rather than opened — a pager that launches a browser is
a surprise, and OSC 8 already makes them clickable.

**It remembers where you were.** Reopening a file lands you back at the same
place. What's stored is the *block*, not the row, so it survives being reopened
in a different-sized window. `--no-resume` opens at the top.

**`y` copies the code block on screen** over OSC 52, which works through SSH and
inside tmux where `pbcopy` cannot reach your actual clipboard.

## Options

```
-w, --width N       Text column width (default 88). 0 fills the terminal.
    --theme NAME    auto, dark or light (default auto, read from COLORFGBG)
-p, --plain         No colour at all. NO_COLOR does the same.
-n, --line-numbers  Number the lines inside code blocks
    --links MODE    osc8 (clickable, default), ref (numbered), plain (URL inline)
    --wrap          Chop wide code and tables to fit, rather than scrolling
    --no-resume     Always open at the top
    --no-pager      Print and exit even on a terminal
    --watch         Re-render when the file changes on disk
    --text          Show the file verbatim, with no markup parsing
    --markdown      Parse as markdown even if the extension says otherwise
```

## It behaves like a Unix tool

```sh
folio README.md          # a pager
folio README.md | cat    # plain text, no escape codes
FORCE_COLOR=3 folio R.md | less -R
cat NOTES.md | folio     # still interactive, via /dev/tty
folio --watch spec.md    # re-renders as you edit
```

Exit status is 0 for success, 1 for a document that could not be read, 2 for bad
usage. Piping in a document still opens a real pager: the content comes from
stdin and the keyboard is borrowed from the controlling terminal.

Formats it does not understand — `.org`, `.txt`, `.rst`, `.adoc`, a log — are
shown verbatim rather than misread as markdown. Org's `*` headings are not
emphasis, and pretending otherwise misrepresents the file.

## How it works

The whole design rests on one split:

```
source ──parse──▶ tokens ──layout──▶ Line[]   once, per (source, width, theme)
                                       │
                            offset ────┴──▶ compose ──▶ frame   per scroll
```

`layoutDoc` is a pure function returning an array of fully-styled rows. Scrolling
only changes an integer, and the Ink tree is one `Text` node per visible row — so
a 6,246-row document costs exactly what a 30-row one costs. Measured on an M1:

| | |
|---|---|
| Lay out a 6,246-row document | 135 ms, once, at open |
| Compose one frame of it | 0.10 ms |
| Ink drawing that frame | ~30 ms |

Highlighting is the expensive part of layout, so the first frame is drawn without
it and replaced when the grammars are ready. Only the languages a document
actually uses are loaded.

## Development

```sh
npm test              # 192 unit and property tests
npm run lint && npm run typecheck && npm run build
npm run verify:smoke  # the no-terminal paths
npm run verify:pty    # a real pty: drive it, signal it, check what it restored
npm run preview -- test/fixtures/kitchen-sink.md 100   # layout only, no TUI
npm run preview:html  # real frames to docs/preview.html, for reviewing colour
```

`INVARIANTS.md` is the contract: twenty-three numbered invariants, each with a
test whose name starts with its number, so `npx vitest run -t "I-6"` runs exactly
the resize-anchoring guard.

Two things worth knowing if you hack on it. `bin` and `npm link` point at
compiled output in `dist/`, so source edits do nothing until `npm run build`.
And anything that needs to line up in a column has to live in a row's *lead*,
not its body — the wrapper collapses runs of whitespace, so padding written into
the text itself will not survive it.

## Licence

MIT
