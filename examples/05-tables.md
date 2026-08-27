# Tables

A table is the one construct where a terminal viewer has to solve a layout
problem rather than just wrap text. Column widths depend on every cell in the
column, cell widths depend on display cells rather than characters, and the
whole thing has to survive being narrower or much wider than the screen.

folio solves the columns once, at layout, and then never again. Scrolling a
table sideways moves an integer.

## The simple case

| Key | Moves |
|---|---|
| `j` `k` | one line |
| `d` `u` | half a screen |
| `f` `b` `space` | a full screen |
| `g` `G` | top, bottom |
| `h` `l` | sideways over a wide block |
| `0` | back to the left edge |

The header rule is a real rule, not a colour, so the table still reads as a
table when you pipe it through `cat` or set `NO_COLOR`.

## Alignment

The colons in the delimiter row set each column's alignment: `:---` is left,
`:---:` is centre, `---:` is right, and a bare `---` is left by default.

| Left | Centre | Right | Default |
|:---|:---:|---:|---|
| a | a | a | a |
| longer | longer | longer | longer |
| much longer still | much longer still | much longer still | much longer still |
| 1 | 22 | 333 | 4444 |

Numbers belong in a right-aligned column. It is the difference between a set
of figures you can compare at a glance and a set you have to read one at a
time:

| Operation | Rows | Cost |
|:---|---:|---:|
| Lay out a short document | 30 | 2 ms |
| Lay out a long one | 6,246 | 135 ms |
| Compose one frame | 24 | 0.10 ms |
| Ink drawing that frame | 24 | ~30 ms |
| Scroll one line | 1 | 0 ms |

Alignment is applied by padding the row's *lead*, not by writing spaces into
the cell text. The wrapper collapses runs of whitespace, so padding written
into a span would not survive it — which is the kind of bug that only shows up
in the one column you did not check.

## Formatting inside cells

Cells hold inline markdown, so everything from the basics file works in them:

| Flag | Default | What it does |
|---|---|---|
| `-w`, `--width` | **88** | Text column, in columns. `0` fills the terminal. |
| `--theme` | *auto* | `auto`, `dark` or `light`. Auto reads `COLORFGBG`. |
| `-p`, `--plain` | off | No colour at all. `NO_COLOR` does the same. |
| `-n`, `--line-numbers` | off | Number the lines inside ***code blocks***. |
| `--wrap` | off | Chop wide blocks to fit, rather than ~~scrolling~~ panning. |
| `--watch` | off | Re-render when the file changes. See [Links](04-links.md). |
| `--text` | off | Show the file verbatim, with `no markup parsing` at all. |

A literal pipe inside a cell has to be escaped, or it splits the row:

| Pattern | Meaning |
|---|---|
| `a\|b` | either `a` or `b` |
| `[[target\|label]]` | a wikilink with a label |
| `folio x.md \| cat` | a pipeline, with the pipe escaped |

## Ragged rows

Markdown does not require every row to have the same number of cells. Short
rows are padded out and long ones are truncated to the header's width — which
is the GFM rule, and worth knowing about because a stray pipe silently loses
you a column.

| One | Two | Three |
|---|---|---|
| a | b | c |
| a | b |
| a |
| a | b | a fourth cell follows this one | and is dropped |
| | | the first two cells are empty |
|  |  |  |

The fourth row has four cells and the header has three, so the fourth is
dropped and you never see it — which is exactly why a stray unescaped pipe in
a cell is such a quiet way to lose data. The last row is entirely empty, which
is legal and renders as a blank row rather than as nothing at all.

## A very wide table

This one is much wider than any terminal you are likely to be using. It is laid
out at its full width and the viewport moves over it — `l` and `h` to pan, `0`
to snap back. The prose you are reading right now does not move, because it is
already wrapped to fit. `‹` and `›` mark whichever edge continues, and the
status bar shows `↔` while you are shifted.

| Release | Date | Layout engine | Navigation | Terminal safety | Formats | Notes |
|---|---|---|---|---|---|---|
| 0.1.0 | 2026-08-13 | Pure `layoutDoc`, one pass per document | Search, contents pane | Alternate screen restored on every exit path | Markdown only | First cut. The split between layout and viewport was already the whole design. |
| 0.2.0 | 2026-08-20 | Natural-width blocks, horizontal offset | Link following, `Backspace` to go back | Raw mode only with a terminal on both ends | Markdown, plus verbatim for `.org` | Resume by block index, so a position survives a resize. |
| 0.3.0 | 2026-08-24 | Centring margin pulled back so it never costs text | Sideways offset clamped to the rows on screen | Ctrl-C quits from every mode, not only the document | Source and config files shown verbatim | The wide-block work that made 200-column terminals usable. |
| 0.3.1 | 2026-08-26 | Unchanged | Unchanged | EPIPE means the reader stopped reading, and exits 0 | Directories and binaries refused with a reason | Mostly verification: a real pty, driven and then signalled. |

If you would rather this were chopped to fit than scrolled over, run it with
`--wrap`. Neither is the right answer for everyone, which is why it is a flag
and not a decision.

## Wide characters and emoji

A CJK ideograph occupies two terminal cells and one JavaScript character. A
viewer that measures with `String.length` gets every column in this table
wrong, and the errors compound down the rows:

| 语言 | Language | 名称 | Width per glyph | Status |
|:---|:---|:---|---:|:---:|
| 中文 | Chinese | 简体中文 | 2 | ✅ |
| 日本語 | Japanese | にほんご | 2 | ✅ |
| 한국어 | Korean | 한국말 | 2 | ✅ |
| English | English | Latin | 1 | ✅ |
| Ελληνικά | Greek | Ελληνικά | 1 | ✅ |
| Русский | Russian | Русский | 1 | ✅ |
| العربية | Arabic | العربية | 1 | ⚠️ |
| 🇯🇵 🇰🇷 🇨🇳 | Flags | regional indicators | 2 | 🚀 |

The `⚠️` in the Arabic row is there for a reason: it is a variation selector
sequence, two code points wide zero and one, which together draw as two cells.
Measuring per code point gets it wrong in both directions. The Arabic itself is
right-to-left, which a terminal handles at display time and a layout engine has
no business trying to reorder — [the unicode file](07-unicode.md) goes into
that properly.

## A table with everything at once

| # | Item | 说明 | Done | Cost |
|---:|:---|:---|:---:|---:|
| 1 | **Layout** runs once | 布局只跑一次 | [x] | 135 ms |
| 2 | *Scrolling* is an integer | 滚动是个整数 | [x] | 0.10 ms |
| 3 | `Tab` picks a link | 选择链接 | [x] | — |
| 4 | Kitty graphics for ~~images~~ | 内联图片 | [ ] | ? |
| 5 | 一个很长的中文单元格，用来确认列宽是按显示宽度算的 | 混合 CJK 与 ASCII | [ ] | n/a |

## Where to next

Back to the [index](README.md), or on to [Diagrams](06-diagrams.md).
