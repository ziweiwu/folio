---
title: The Kitchen Sink
author: Ziwei Wu
date: 2026-08-13
tags: markdown, terminal, testing
---

# folio

A terminal markdown viewer that treats **typography** as a feature, not an
afterthought. It aims to render a README the way you'd actually want to *read*
one — with room to breathe, real syntax highlighting, and scrolling that keeps
up with your keyboard.

## Why another one?

Existing viewers re-render the whole document on every scroll. That's fine for a
short file and miserable for a long one. This one lays out once and then only
slices, so a 10,000-line document scrolls exactly as fast as a 30-line one.

### The short version

Layout is a pure function. Scrolling is an integer. Those two facts do most of
the work.

#### Even deeper

Heading levels four through six exist, so they get rendered too.

## Features

- Real word wrapping, with hanging indents so wrapped lines line up
- Syntax highlighting via Shiki, using actual TextMate grammars
- Tables that solve their own column widths
  - Including nested lists, which indent properly
  - And keep their bullets distinct at each depth
    - Three levels deep still reads cleanly
- Mouse wheel support, because it's 2026

### Task list

- [x] Pure layout engine
- [x] Width-correct measurement for CJK and emoji
- [ ] Inline images via the kitty graphics protocol
- [ ] A stash, like glow has

### Ordered

1. Parse the markdown into tokens
2. Lay the tokens out into styled spans
3. Wrap the spans to the text column
4. Paint the spans into ANSI strings

## Code

Inline code like `npm install` or `const x = 1` gets a tinted background.

```typescript
export function layoutDoc(src: string, opts: LayoutOptions): Doc {
  const { frontMatter, tokens } = parseMarkdown(src);
  const { left, inner } = geometry(opts);
  // Pure: same input, same output, every time.
  return finalize(render(tokens), opts, inner);
}
```

```bash
# Install it, then read something
npm install -g @ziweiwu/folio
folio README.md
```

## Tables

| Operation | Cost | Notes |
|---|---:|:---|
| Layout a 10k-line document | 180 ms | Once, at open |
| Scroll one line | 0 ms | It's an array slice |
| Render one frame | ~30 ms | Ink's floor, not ours |
| Resize | 180 ms | Re-layout, re-anchored |

## Quotes

> The most expensive thing a TUI does is draw.
>
> Reducing render **frequency** is the only lever that reliably works.
>
> > And nested quotes deepen the bar, so you can see the nesting.

## Links and the rest

Here's a [link to the repository](https://github.com/ziweiwu/folio),
and a bare autolink: https://example.com/some/quite/long/path/that/needs/wrapping

~~Struck-through text~~ renders struck through. Wide characters measure
correctly: 你好世界 and 日本語のテキスト and emoji ⚠️ 🚀 ✅ all take two cells each.

![A diagram of the render pipeline](docs/pipeline.png)

---

That's the lot.
