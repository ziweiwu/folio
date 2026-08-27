# folio by example

A guided tour of everything folio knows how to draw. Every file here is a real
document you can read — open this one and press `Tab` to walk the links,
`Enter` to follow one, `Backspace` to come back.

```sh
folio examples/README.md
```

If you are reading this on GitHub instead, the links work here too; they are
ordinary relative paths.

## The tour

1. [Basics](01-basics.md) — headings, paragraphs, emphasis, quotes, rules and
   the small punctuation details that decide whether a page reads well.
2. [Lists](02-lists.md) — bullets, numbers, task boxes, and what happens when
   you put a table inside a quote inside a list item.
3. [Code](03-code.md) — fenced blocks in a dozen languages, the fallback when
   the language is nonsense, and lines far too long for your terminal.
4. [Links](04-links.md) — relative paths, anchors, wikilinks, and one
   deliberately broken link so you can see how folio reports a dead end.
5. [Tables](05-tables.md) — alignment, formatting inside cells, ragged rows,
   and a table much wider than the screen.
6. [Diagrams](06-diagrams.md) — mermaid, ASCII art and `tree` output, all of
   which folio shows verbatim rather than pretending to render.
7. [Unicode](07-unicode.md) — CJK, emoji, combining marks and right-to-left
   text. This is the one that breaks viewers that count characters instead of
   measuring cells.
8. [Front matter](08-frontmatter.md) — YAML metadata at the top of a note,
   lifted into a header instead of dumped as a code block.

## Reading these usefully

| Try this | To see |
|---|---|
| `folio examples/03-code.md` | syntax highlighting arriving after first paint |
| `folio -w 0 examples/05-tables.md` | the text column filling the terminal |
| `folio --wrap examples/05-tables.md` | wide blocks chopped instead of scrolled |
| `folio -p examples/07-unicode.md` | that colour was never the only signal |
| `folio examples/06-diagrams.md \| cat` | plain text, no escape codes at all |
| `folio -n examples/03-code.md` | line numbers inside code blocks |

Each file opens with a short note on what it is stressing, so you can tell a
rendering bug from a deliberately awkward construct.

## A note on what these are for

They are demonstration documents first and test fixtures second. Everything in
them is prose someone might actually write — there is no filler text — because
a viewer that only looks right on lorem ipsum has not been tested at all.
