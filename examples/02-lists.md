# Lists

Lists are where terminal markdown viewers usually come apart. The marker has to
sit in the margin, the wrapped text has to line up under the first word rather
than under the bullet, and every level of nesting has to indent without ever
pushing content off the right edge. This file pushes on all of that.

## Unordered, and as deep as you like

- The first level, with a marker that sits in the margin
- A long item, to show the hanging indent: when this line runs past the text
  column it wraps under the word "long" and not under the bullet, so the block
  keeps a clean left edge you can read down
  - The second level takes a different marker, so depth is visible without
    counting spaces
  - Another second-level item
    - Third level
      - Fourth level, which is about where a document should stop
        - Fifth level, included because the layout engine has to survive it
          - Sixth level. If your document has one of these, it wants to be a
            table or a set of headings instead.
    - Back up to the third
- And back to the first

The markers cycle rather than repeating, so two adjacent levels never look the
same. That is a redundant signal on top of the indentation: if your terminal is
narrow enough that the indents crowd, the markers still tell you where you are.

## Ordered lists

1. Parse the markdown into tokens
2. Lay the tokens out into styled spans
3. Wrap the spans to the text column
4. Paint the spans into ANSI strings

Numbers are right-aligned against each other, so a list that crosses from one
digit to two does not shift its text sideways:

1. First
2. Second
3. Third
4. Fourth
5. Fifth
6. Sixth
7. Seventh
8. Eighth
9. Ninth
10. Tenth — note that the text still starts in the same column as "First"
11. Eleventh

### Starting somewhere other than one

A list that starts at another number keeps its numbering, which matters when
you are continuing a sequence across a section break:

5. The fifth step, picked up after an interruption
6. The sixth
7. The seventh

And a list can count from zero, which is what you want for anything indexed
the way a programmer indexes:

0. The zeroth element
1. The first
2. The second

The numbers you write after the first are ignored — markdown renumbers. All of
these come out as 1, 2, 3:

1. One
1. Two
1. Three

## Task lists

- [x] Pure layout engine, run once per document
- [x] Width-correct measurement for CJK and emoji
- [x] Horizontal scrolling over wide code and tables
- [ ] Inline images via the kitty graphics protocol
- [ ] A stash, the way glow has one
- [ ] Anything at all resembling a configuration file

Checked and unchecked both draw a real box — `[x]` and `[ ]` — rather than
relying on colour, so the list still reads under `--plain` or `NO_COLOR`.

Task items nest like any other list item:

- [ ] Ship version 1.0
  - [x] Lock the invariant contract
  - [x] Get the pty verification onto CI
  - [ ] Write the examples
    - [x] Basics
    - [x] Lists
    - [ ] Everything after lists

## Tight and loose lists

A *tight* list has no blank lines between its items, and is set with no extra
space between them:

- Compile
- Link
- Run

A *loose* list has a blank line somewhere inside it, and every item gets its
paragraph spacing:

- Compile the sources into objects, once per translation unit.

- Link the objects into an executable, resolving symbols across them.

- Run it, and discover what you forgot.

The difference is not cosmetic. A tight list is a set of labels you scan; a
loose one is a set of small paragraphs you read. Mixing them in one document is
fine, but mixing them in one list is not — markdown will make the whole list
loose if any part of it is.

## Items that contain other blocks

A list item can hold anything a document can hold, as long as the content is
indented to line up with the item's text.

1. **A code block inside an item.** Indented to match, so it stays inside the
   item rather than terminating the list:

   ```sh
   folio examples/02-lists.md
   ```

2. **A quote inside an item.** The bar indents with the item:

   > A list item is a container, not a line. Everything that works at the top
   > level works inside one.

3. **A table inside an item.** Column solving happens inside the item's width,
   not the terminal's:

   | Key | Moves |
   |---|---|
   | `j` | one line down |
   | `k` | one line up |
   | `d` | half a screen |

4. **A nested list inside an item**, mixing kinds:

   - An unordered child
     1. with an ordered grandchild
     2. and a second one
   - Another unordered child

5. **Several paragraphs inside an item.**

   This is the second paragraph of item five. It is indented three spaces to
   line up under "Several", which is what keeps it part of the item instead of
   ending the list and starting a new block.

   And a third, for good measure.

## Definition-list style

Markdown has no definition lists. Pandoc added a syntax for them — a term, then
a line starting with a colon — and it is worth seeing what happens when you
write it anywhere else, because "anywhere else" includes GitHub, folio, and
almost every other renderer:

**`--width N`**
: Sets the text column, in columns. The default is 88, which is roughly the
  measure a book uses.

**`--theme NAME`**
: `auto`, `dark` or `light`. Auto reads `COLORFGBG` from your terminal.

Each of those comes out as a single paragraph with a stray colon in the middle
of it, because that is what the markdown actually says: a term line and a
colon line with no blank line between them are one paragraph. folio does not
guess otherwise. Showing you the document you wrote — colon and all — is more
honest than inventing a construct the syntax does not have.

The same trap catches the other common idiom, a bold term followed by an
indented line. The indent is invisible to markdown, so this is one paragraph
too:

**A block**
  A run of rows the layout engine produced from one markdown token.

What *does* work is a list, which markdown does have. Either put the definition
after the term:

- **A block** — a run of rows the layout engine produced from one markdown
  token. Positions are remembered as block indices rather than row numbers,
  because rows depend on how wide the window was when you last read the file.
- **A frame** — exactly as many rows as the terminal is tall, each padded to
  its full width. Composing one is an array slice and some string work, about
  a tenth of a millisecond whatever the document's size.
- **The measure** — the width prose is wrapped to, 88 columns by default.
  Wide blocks ignore it; that is what makes them wide.

Or nest it, which gives you the hanging indent the pandoc form was reaching
for in the first place:

- **`--width N`**
  - Sets the text column, in columns. `0` means "fill the terminal", which is
    what you want for tables and almost never what you want for prose.
- **`--links MODE`**
  - `osc8` makes links clickable in terminals that support it, `ref` numbers
    them and prints a list at the end, `plain` puts the URL inline. All three
    keep the target on the row, so `Tab` and `Enter` work regardless.

## Where to next

Back to the [index](README.md), or on to [Code](03-code.md).
