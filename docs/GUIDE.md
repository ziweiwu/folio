# The folio guide

Everything folio does, in the order you are likely to need it. If you only read
one section, read [Moving around](#moving-around).

Inside the viewer, `?` lists every key without leaving the page you are on, and
`folio --help` prints the options. This guide is the long version of both.

## Contents

- [Getting it](#getting-it)
- [Opening something](#opening-something)
- [Moving around](#moving-around)
- [Wide things: code and tables](#wide-things-code-and-tables)
- [Finding things](#finding-things)
- [Following links](#following-links)
- [Using the mouse](#using-the-mouse)
- [Copying code](#copying-code)
- [Where you left off](#where-you-left-off)
- [Watching a file as you edit it](#watching-a-file-as-you-edit-it)
- [Colour and themes](#colour-and-themes)
- [Width and layout](#width-and-layout)
- [Files that are not markdown](#files-that-are-not-markdown)
- [Using it in a pipeline](#using-it-in-a-pipeline)
- [Reading the status bar](#reading-the-status-bar)
- [When something looks wrong](#when-something-looks-wrong)
- [Every option](#every-option)
- [Every key](#every-key)

## Getting it

```sh
npm install -g @ziweiwu/folio
```

It needs Node 22 or newer. There is no configuration file, nothing to set up,
and nothing to learn before the first document.

```sh
folio README.md
```

## Opening something

```sh
folio README.md            # a file
cat NOTES.md | folio       # standard input
folio < NOTES.md           # the same, redirected
folio -- -weird-name.md    # a filename that starts with a dash
folio docs/                # refused, with the reason
```

With a terminal on both ends, folio opens a pager. Piped or redirected, it
prints the rendered document and exits — see [Using it in a
pipeline](#using-it-in-a-pipeline).

Reading from a pipe still gets you the full interactive viewer. folio opens the
controlling terminal for keystrokes even when standard input is busy carrying
the document, so `curl -s $URL | folio` is a real pager and not a dump.

## Moving around

The keys are the ones you already know from `less` and vim.

| Key | Moves |
|---|---|
| `j` `k` or `↓` `↑` | one line |
| `d` `u` | half a screen |
| `f` `b` or `space` | a full screen |
| `g` `G` | the top, the bottom |
| wheel | three lines |

Hold a key down and it stays smooth. A held key arrives from the terminal as a
burst of characters in one read, and folio applies the burst as the keystrokes
it stands for rather than as one — which is why it does not fall behind and then
lurch.

Resizing the window keeps your place. The document is laid out again at the new
width, so the line you were on has a different number — folio re-anchors to the
*block* you were reading rather than the row index, and you stay on the same
paragraph.

## Wide things: code and tables

A long command or a wide table is laid out at its full width rather than being
chopped to fit, and the viewport moves over it:

| Key | Moves |
|---|---|
| `h` `l` or `←` `→` | sideways, about a word at a time |
| `0` | back to the left edge |

Only the wide rows move. The prose around them stays exactly where you were
reading it, so you never lose the sentence that explains the command.

A row that continues past the edge of the screen says so with a `›`, and one
that continues to the left with a `‹`. When the viewport has moved sideways the
status bar shows `↔` and by how much.

If you would rather have everything chopped to fit — no sideways scrolling at
all — use `--wrap`.

## Finding things

Press `/`, type, press `Enter`.

| Key | Does |
|---|---|
| `/` | open the search prompt |
| `Enter` | run the search |
| `n` `N` | next match, previous match |
| `Esc` | abandon the search |

Search is **smartcase**: an all-lowercase query matches any case, and a query
with a capital in it means you meant that capital. A hit lands a third of the
way down the screen rather than at the very top, so you keep the context above
it. Every jump reports which match you are on out of how many, so you can tell
three hits from thirty and see it wrap round to the first.

## Following links

| Key | Does |
|---|---|
| `Tab` `⇧Tab` | pick the next link, the previous one |
| `Enter` | follow the picked link |
| `Backspace` | go back to where you came from |

The picked link is marked on the page and scrolled into view, so `Tab` is also a
way of finding out what a document links to.

What each kind of link does:

- **A relative path** opens that file — `./guide.md`, or `guide` with no
  extension, or a directory that has an `index.md` inside it.
- **An `#anchor`** jumps to that heading, using the same slug rules GitHub
  links with, so `#why-another-one` finds "Why another one?".
- **A path with an anchor** — `guide.md#setup` — does both.
- **`[[Wikilinks]]`** work, along with `[[target|label]]` and
  `[[target#heading]]`, so an Obsidian or Foam vault reads properly.
- **An external URL** is shown in the status bar rather than opened. A pager
  that launches a browser is a surprise. Your terminal can still open it: links
  are marked as OSC 8 hyperlinks, which most terminals make clickable.

`--links` changes how URLs are presented: `osc8` (the default) marks them as
hyperlinks, `ref` collects them into numbered footnotes at the end, and `plain`
prints the URL after the text.

## Using the mouse

If your terminal reports mouse events — most do — then:

- **The wheel** scrolls three lines a notch.
- **A click** follows the link under the pointer. It picks that link and
  follows it in one action, exactly as `Tab` then `Enter` would.

A click that lands on ordinary text does nothing at all, deliberately: most of a
page is not a link, and a viewer that announced every stray click would spend
the status bar on noise. Nor is a click on chrome a click on the page — the
status bar, the scrollbar, the `‹` and `›` edge marks, and anything at all while
the search prompt, the contents or the key list is open.

Mouse reporting does not depend on colour: `--plain` and `NO_COLOR` change how
the page is drawn, not how you point at it.

Holding shift, control or meta does not change what a click means — a modified
click is still a click.

If you would rather your terminal's own selection and copy behaviour took
precedence, most terminals give you that by holding shift while you drag.

## Copying code

Press `y` and the first code block on screen goes to your clipboard. With none
on screen it says so.

It travels over OSC 52, which means it works through SSH and inside tmux, where
`pbcopy` and `xclip` cannot reach. The message says the text was *sent*, not
that it was copied, because OSC 52 is advisory — a terminal is allowed to refuse
it, and some do, usually for good reason. If nothing arrives, your terminal
declined; in tmux this is `set -g set-clipboard on`.

What gets copied is the block's source, exactly as it appears in the file — no
frame, no line numbers, no highlighting.

## Where you left off

Close a long document, reopen it later, and you are back where you were. A
one-line note says so.

What is stored is the *block* you were reading, not a line number, so it
survives being reopened in a window of a different size. `--no-resume` opens at
the top instead.

## Watching a file as you edit it

```sh
folio --watch spec.md
```

The document re-renders when the file changes on disk, keeping your position.
`r` reloads on demand without `--watch`.

An editor that writes a file twice on one save fires two changes; only the newest
read is allowed to land, so you never get stale text restored under a "reloaded"
note.

## Colour and themes

Colour follows your terminal's capabilities. `--theme dark`, `--theme light` or
`--theme auto` (the default, read from `COLORFGBG`) picks the palette.

- `-p` / `--plain` turns colour off entirely. So does `NO_COLOR`.
- With colour off, nothing is lost: headings keep their rules, tasks keep their
  boxes, code keeps its frame, and search matches and the picked link are marked
  with reverse video. Colour is always a redundant signal here, never the only
  one.

Syntax highlighting uses [Shiki](https://shiki.style) — the same grammars and
themes VS Code uses. Only the grammars a document actually uses are loaded, so a
file with no code blocks costs nothing, and an unknown or broken language
degrades that one block to plain text rather than blanking it.

## Width and layout

Text is set in a column capped at 88 cells by default, because a line that runs
the full width of a wide terminal is genuinely harder to read. The column is
centred on the page.

```sh
folio -w 100 README.md     # a wider text column
folio -w 0 README.md       # fill the terminal
```

Code blocks and tables are not subject to that cap — they are laid out at their
natural width. On a terminal much wider than the text column, such a block is
pulled back out of the margin so that it uses the room the screen actually has
before anything is clipped, while a block that already fits stays aligned with
the prose around it.

`-n` / `--line-numbers` numbers the lines inside code blocks.

## Files that are not markdown

folio shows a file verbatim when parsing it as markdown would misrepresent it:

- `.org`, `.txt`, `.rst`, logs — Org's `*` headings are not emphasis.
- Source and configuration — `.py`, `.ts`, `.json`, `.yaml`, dotfiles, a
  `Makefile`. Markdown joins consecutive lines into one paragraph, so parsing
  one of these would delete the indentation that *is* the file.

An unknown extension still defaults to markdown, because that is what people
point this at. `--markdown` forces the parser, `--text` forces verbatim.

A directory or a binary file is refused with the cause and the remedy, rather
than rendered as pages of caret notation.

## Using it in a pipeline

```sh
folio README.md            # a pager
folio README.md | cat      # plain text, no escapes
folio README.md | head -20 # exits 0 when head closes the pipe
folio --no-pager doc.md    # print and exit, even on a terminal
```

Piped output carries no escape codes and no trailing whitespace. Wide content is
clamped to the output width — your terminal's when one is attached, and 80
columns when the output is a pipe or a file, since neither has a width of its
own — with a `›` where it was cut, so a table can never print past the edge.

Exit status is `0` for success, `1` for a document that could not be read, and
`2` for bad usage. Errors state both the cause and what to do about it.

## Reading the status bar

From left to right:

```
 README.md  ·   42%  ·  ## Options  ·  ↔ 12          / search   t toc   ? keys   q quit
```

- the filename
- how far through the document you are
- the heading you are currently inside — not just a percentage
- `↔` and a number when the viewport has moved sideways
- the key legend

On a narrow terminal the legend gives way one item at a time from the front, so
`q quit` and `? keys` are the last to go: you can always leave, or find out how.
A transient message — a copied block, a followed URL, a link that went nowhere —
replaces the whole bar for a moment and then the bar comes back.

## When something looks wrong

**Text is cut off on the right.** Look for a `›` at the edge — that row is wider
than the screen. Press `l` to move over it, `0` to come back. If `l` does
nothing the row is clipped rather than pannable, which is always the case under
`--wrap`; the `↔` in the status bar is what confirms the viewport really moved.

**The whole page looks too narrow on a big monitor.** That is the 88-cell text
column, on purpose. `-w 0` fills the terminal, `-w 120` picks your own cap.

**Colours look wrong or absent.** Check `NO_COLOR`, then try `--theme dark` or
`--theme light` explicitly; `auto` reads `COLORFGBG`, which not every terminal
sets.

**`y` says it sent the code but nothing was copied.** Your terminal declined the
OSC 52 request. In tmux, `set -g set-clipboard on`.

**Clicking does nothing.** Your terminal may not be reporting mouse events, or
you may be clicking something that is not a link. `Tab` picks links from the
keyboard and always works.

**A code block lost its colours.** That language has no grammar, or its grammar
failed to compile. The block degrades to plain text rather than disappearing.

**A `.txt` or `.json` file is not being formatted.** That is deliberate — see
[Files that are not markdown](#files-that-are-not-markdown). `--markdown`
overrides it.

## Every option

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
-h, --help          Show the short help
    --version       Print the version
```

## Every key

```
j k ↓ ↑      one line              d u          half a screen
f b space    a full screen         g G          top, bottom
h l ← →      sideways              0            back to the left edge
wheel        three lines           click        follow the link under it

tab ⇧tab     pick a link           enter        follow it
backspace    go back               y            copy the code block on screen
/            search                n N          next, previous match
t            contents              r            reload from disk
?            all keys              q esc ^C     quit
```

`Ctrl-C` quits from everywhere. `q` quits from the page, the contents and the
key list — inside the search prompt it is just a letter. `Esc` quits from the
page; everywhere else it closes what is open, abandoning the prompt or the
pane. There is no mode you can get stuck in.
