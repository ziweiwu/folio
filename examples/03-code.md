# Code

Code is the reason most people open a README in a terminal in the first place.
folio highlights it with Shiki — the same TextMate grammars and themes VS Code
uses — so keywords, types, strings and functions are genuinely distinct rather
than uniformly tinted.

Highlighting never delays the first frame. The document is drawn plain and
repainted when the grammars finish loading, and only the languages this file
actually uses get loaded at all. On a document with two hundred code blocks
that is about 95 ms of work that costs you nothing at open.

## TypeScript

```typescript
import type { Theme } from '../ui/theme.js';

export type LayoutOptions = {
  readonly width: number;
  readonly maxWidth: number;
  readonly theme: Theme;
  readonly overflow: 'wrap' | 'scroll';
};

/** Pure: the same source, width, theme and options give byte-identical rows. */
export function layoutDoc(source: string, opts: LayoutOptions): Doc {
  const { frontMatter, tokens } = parseMarkdown(sanitize(source));
  const { left, inner } = geometry(opts);
  const lines = tokens.flatMap((token) => renderBlock(token, inner, opts.theme));
  return { lines, toc: headings(tokens), frontMatter, left };
}
```

## Python

```python
from dataclasses import dataclass
from typing import Iterator


@dataclass(frozen=True, slots=True)
class Span:
    """A run of text sharing one style. The unit layout works in."""

    text: str
    style: str | None = None

    def width(self) -> int:
        return display_width(self.text)


def wrap(spans: list[Span], measure: int) -> Iterator[list[Span]]:
    """Greedy wrap by display cells, never by len()."""
    line, used = [], 0
    for span in spans:
        if used + span.width() > measure and line:
            yield line
            line, used = [], 0
        line.append(span)
        used += span.width()
    if line:
        yield line
```

## Rust

```rust
use std::collections::BTreeMap;

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Heading { level: u8, text: String },
    Paragraph(Vec<Span>),
    Code { lang: Option<String>, body: String },
}

impl Block {
    /// Rows this block occupies once wrapped to `measure` cells.
    pub fn height(&self, measure: usize) -> usize {
        match self {
            Block::Heading { .. } => 2,
            Block::Paragraph(spans) => wrap(spans, measure).count(),
            Block::Code { body, .. } => body.lines().count() + 2,
        }
    }
}

fn main() {
    let counts: BTreeMap<&str, usize> = BTreeMap::new();
    println!("{counts:?}");
}
```

## Go

Go is written with tabs, which is a useful case in itself: a tab has no width
of its own — it means "advance to the next tab stop" — so it has to be expanded
against real tab stops before anything measures the row, or the right-hand
border of the block lands in the wrong column.

```go
package layout

import (
	"strings"
	"unicode/utf8"
)

// DisplayWidth counts terminal cells, not runes and not bytes.
func DisplayWidth(s string) int {
	width := 0
	for _, r := range s {
		switch {
		case r == 0xFE0F:
			width++ // a variation selector widens the glyph before it
		case isCombining(r):
			// zero width, by definition
		case isWide(r):
			width += 2
		default:
			width++
		}
	}
	return width
}

func Indent(s string, n int) string {
	pad := strings.Repeat(" ", n)
	return pad + strings.ReplaceAll(s, "\n", "\n"+pad)
}

var _ = utf8.RuneCountInString
```

## Shell

```bash
#!/usr/bin/env bash
set -euo pipefail

# Hermetic: never read or write the positions a real reader has accumulated.
state=$(mktemp -d)
trap 'rm -rf "$state"' EXIT
export XDG_STATE_HOME="$state"

for cols in 40 60 80 100 160 200; do
  if ! npx tsx scripts/frame.ts examples/03-code.md "$cols" 40 >/dev/null; then
    echo "failed at ${cols} columns" >&2
    exit 1
  fi
done

echo "all widths rendered"
```

## JSON

```json
{
  "name": "@ziweiwu/folio",
  "version": "0.3.1",
  "type": "module",
  "bin": { "folio": "dist/cli.js" },
  "engines": { "node": ">=20" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "test": "vitest run",
    "verify:smoke": "bash scripts/smoke.sh"
  },
  "keywords": ["markdown", "terminal", "pager", "cli", "tui"]
}
```

## YAML

```yaml
name: ci
on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run typecheck && npm run lint && npm test
      - run: npm run verify:smoke
```

## SQL

```sql
-- Which documents did we spend the most time in last week?
SELECT
    d.path,
    COUNT(*)                       AS opens,
    ROUND(AVG(s.duration_ms) / 1000, 1) AS avg_seconds
FROM sessions AS s
JOIN documents AS d ON d.id = s.document_id
WHERE s.opened_at >= DATE('now', '-7 days')
GROUP BY d.path
HAVING opens > 1
ORDER BY avg_seconds DESC
LIMIT 20;
```

## HTML

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Frame preview</title>
    <style>
      body { background: #1e1e2e; margin: 0; }
      pre  { font: 14px/1.4 ui-monospace, monospace; color: #cdd6f4; }
    </style>
  </head>
  <body>
    <pre id="frame"><!-- one composed frame goes here --></pre>
  </body>
</html>
```

## CSS

```css
:root {
  --ground: #1e1e2e;
  --text: #cdd6f4;
  --rule: #45475a;
  --accent: #89b4fa;
}

.frame {
  background: var(--ground);
  color: var(--text);
  font: 14px / 1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 1.5rem 2rem;
  white-space: pre;
}

.frame .heading {
  color: var(--accent);
  border-bottom: 1px solid var(--rule);
}
```

## Diff

```diff
--- a/src/md/layout.ts
+++ b/src/md/layout.ts
@@ -112,9 +112,12 @@ function codeBlock(token: Tokens.Code, opts: LayoutOptions): Line[] {
-  const width = Math.max(...body.map((l) => l.length));
+  /* Cells, not characters. A block of CJK measured with String.length comes
+     out half as wide as it draws, and the border lands mid-glyph. */
+  const width = Math.max(...body.map((l) => displayWidth(l)));
   const border = '─'.repeat(width + 2);
   return [
     line(theme.rule, `┌${border}┐`),
-    ...body.map((l) => line(theme.code, `│ ${l.padEnd(width)} │`)),
+    ...body.map((l) => line(theme.code, `│ ${pad(l, width)} │`)),
     line(theme.rule, `└${border}┘`),
   ];
 }
```

## No language at all

A fence with no language after it is not an error and not a guess. It is drawn
in the code style, unhighlighted, which is exactly right for output you are
quoting rather than source you are showing:

```
$ folio --version
0.3.1

$ folio examples/03-code.md | wc -l
     412

$ echo $?
0
```

## A language that does not exist

This block is tagged `flibbertigibbet`, which is not a grammar anyone has
written. An unknown language degrades *that one block* to plain text — it never
blanks the block, never falls back to guessing at another grammar, and never
takes the viewer down with it. The same is true of a grammar the JavaScript
regular-expression engine refuses to compile, which is a real category and not
a hypothetical one.

```flibbertigibbet
ceremony frobnicate(widget) -> sprocket {
    unless widget.is_bolted():
        bolt widget onto sprocket;
    otherwise:
        yield sprocket verbatim;
}
```

If you see that text, unstyled and complete, the fallback is working.

## Indented code blocks

Four spaces of indentation is the older way to write a code block, and plenty
of documents still use it. It has no language, so it is never highlighted:

    def fizzbuzz(n):
        for i in range(1, n + 1):
            if i % 15 == 0: print("fizzbuzz")
            elif i % 3 == 0: print("fizz")
            elif i % 5 == 0: print("buzz")
            else: print(i)

The catch is that an indented block cannot be separated from a list item's
continuation paragraph without counting spaces, which is why fences won.

## Lines longer than your terminal

Code is laid out at its natural width and the viewport moves over it. Press `l`
and `h` to pan, `0` to snap back to the left edge. The prose around it does not
move, so you never lose the sentence explaining the command. `‹` and `›` mark
whichever edge continues.

```bash
docker run --rm -it --name folio-ci -v "$PWD:/work" -w /work --env CI=1 --env FORCE_COLOR=3 --env XDG_STATE_HOME=/tmp/state ghcr.io/example/node-with-chromium:20-bookworm sh -lc 'npm ci && npm run build && npm run verify:smoke && npm run verify:screenshots'
short line, for contrast
```

The same thing happens with a single long expression rather than a long command:

```typescript
export const composeFrame = (doc: Doc, view: Viewport, columns: number, theme: Theme, level: ColorLevel): string[] => doc.lines.slice(view.offset, view.offset + view.height).map((line) => clip(decorate(line, theme, level), view.hOffset, columns)).concat(statusBar(doc, view, columns, theme, level));
```

Pass `--wrap` if you would rather have wide blocks chopped to fit than scroll
sideways over them. It is a preference, and folio does not pick for you.

## Trailing whitespace

The three lines below have trailing spaces after them in the source. They must
not survive into the output: piped output carries no trailing whitespace at
all, and inside a frame they would show up as a ragged right border on the
block.

```text
first line, with three spaces after it   
second line, with one   
third line, clean
```

## Where to next

Back to the [index](README.md), or on to [Links](04-links.md).
