# Basics

This file exercises the constructs that make up the bulk of any README:
headings, paragraphs, emphasis, quotes and rules. Nothing here is exotic, which
is the point — if the ordinary case does not read well, nothing else matters.

## Headings, all six levels

Markdown gives you six, and a viewer has to distinguish all of them without
shouting. folio does it with size of gap, weight, and a rule under the top two
levels, so the hierarchy survives `--plain` and a monochrome terminal.

# Level 1 — the document title

Level one gets a full rule and the most air above it. You normally only write
one per file.

## Level 2 — a major section

Level two is the workhorse. It gets a rule too, but a lighter one.

### Level 3 — a subsection

From here down the separation is weight and spacing rather than rules.

#### Level 4 — a sub-subsection

Four levels deep is where most documents stop. Anything past this is usually a
sign the document wants splitting.

##### Level 5 — rare but legal

If you are here, consider whether a definition list or a table would say it
better.

###### Level 6 — the floor

There is no level seven. Seven hashes is a paragraph starting with a hash.

## Paragraphs and line breaks

A paragraph is a run of non-blank lines, joined together and rewrapped to the
text column. That means the line breaks you type inside a paragraph are
invisible in the output — this sentence is written across three source lines
and arrives as one.

Two paragraphs need a blank line between them. Without one, they are the same
paragraph, however much white space you leave at the end of the line.

Sometimes you want the break to survive. End a line with two spaces  
and the next line starts fresh — this is a *hard* break, and it is what you
want for an address, a verse, or a short list of options that is not really a
list.

A backslash at the end of a line does the same thing\
and is easier to see in a diff, because trailing spaces are invisible in most
editors and stripped by many.

## Emphasis

Use `*single asterisks*` for *italic*, `**double**` for **bold**, and
`***triple***` for ***bold italic***. Underscores work the same way: _italic_,
__bold__, ___both___. GitHub's `~~tildes~~` give you ~~strikethrough~~, which
folio draws as real struck-through text rather than as a colour change.

Emphasis composes. You can have **bold text containing *italic* inside it**,
or *italic containing `inline code`*, or ~~struck text with **bold** in it~~.
Each combination is a separate path through the inline renderer, which is why
they are all here.

The two spellings differ in one respect worth knowing. Underscores are ignored
inside a word, so snake_case_names come through intact. Asterisks are not: the
`3` in 2\*3\*4 really is italic, which is why arithmetic and glob patterns
want escaping or a code span — `2*3*4`, `rm *.tmp`.

## Inline code

Inline code gets a tinted background so it reads as a distinct object in the
sentence: `npm install -g @ziweiwu/folio`, `layoutDoc()`, `--no-resume`,
`$HOME/.local/state`.

If the code itself contains a backtick, wrap it in two: `` `code` `` renders as
a literal backtick pair. A run of three works for `` ``nested`` `` and so on
upward. Code spans are never re-wrapped mid-token if there is any way to avoid
it, because a broken flag name is worse than a short line.

## Blockquotes

> A blockquote is a bar in the left margin and a shift in colour. Both signals
> are present in `--plain` output, because the bar is a character and not a
> colour.

Quotes can hold more than one paragraph:

> The most expensive thing a terminal UI does is draw.
>
> Reducing how *often* you draw is the only lever that reliably works. Making
> each draw cheaper helps, but it is a constant factor against an algorithmic
> problem.

And they nest, with the bar deepening at each level:

> A first-level quote, from the person being quoted.
>
> > A second-level quote, which is what they were quoting.
> >
> > > And a third, at which point you should probably restructure the document.

A quote can contain any other block — headings, lists, code, tables — which is
what [Lists](02-lists.md) goes into.

## Horizontal rules

Three or more hyphens, asterisks or underscores on a line of their own all mean
the same thing. Here are all three spellings:

---

***

___

A rule is a section break, not decoration. If you find yourself putting one
between every heading, the headings are already doing that job.

## Escaping

Sometimes you need a character that markdown would otherwise eat. A backslash
in front of it says "this is literal":

- `\*not emphasis\*` gives \*not emphasis\*
- `\_leading underscore` gives \_leading underscore
- `\# not a heading` gives \# not a heading
- `\[not a link\]` gives \[not a link\]
- `\\` gives a single backslash: \\

The characters worth escaping are ``\ ` * _ { } [ ] ( ) # + - . !`` and the
pipe `\|` when it would otherwise split a table cell.

## HTML entities

Named and numeric entities both resolve. This is how you write characters your
keyboard does not have, or ones markdown would misread:

| Written | Renders as |
|---|---|
| `&amp;` | &amp; |
| `&lt;` and `&gt;` | &lt; and &gt; |
| `&copy;` `&reg;` `&trade;` | &copy; &reg; &trade; |
| `&mdash;` `&ndash;` | &mdash; &ndash; |
| `&hellip;` | &hellip; |
| `&#8594;` `&rarr;` | &#8594; &rarr; |
| `&deg;` `&plusmn;` `&times;` | &deg; &plusmn; &times; |
| `&nbsp;` | a non-breaking space, between&nbsp;these&nbsp;words |

The non-breaking space is worth knowing about: it stops the wrapper splitting
`10&nbsp;ms` across two lines, which is the difference between a table of
measurements you can scan and one you cannot.

## Where to next

The rest of the tour is indexed in [README.md](README.md). The next stop is
[Lists](02-lists.md).
