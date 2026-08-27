---
title: Front matter, and what a viewer should do with it
author: Ziwei Wu
date: 2026-08-26
status: published
version: 0.3.1
tags: markdown, terminal, metadata, yaml
标题: 前言元数据的处理方式
作者: 吴子威
言語: 日本語のキーも通ります
summary: This is a deliberately very long front-matter value, written as a single unbroken line so that it is certainly wider than any terminal you might be reading it in, which means the metadata header has to wrap it against the text column exactly the way it would wrap a paragraph rather than letting it run off the right-hand edge or, worse, silently truncating it and leaving you to guess what the rest of it said.
description: A note on why metadata belongs in a header rather than in a code block at the top of every file.
license: MIT
url: https://github.com/ziweiwu/folio
draft: false
weight: 8
---

# Front matter

The block above this heading is YAML front matter: a fenced run of `key: value`
pairs between two lines of three hyphens, at the very top of the file. Static
site generators invented it, Obsidian and Foam adopted it, and now a large
share of the markdown on any given disk starts with one.

## What most viewers do with it

They render it as a code block, because that is what a markdown parser makes of
three hyphens followed by text. So every note you open starts with a grey box
full of punctuation, and you scroll past it to get to the document. It looks
like a mistake at the top of every file.

folio lifts the top-level scalars out and sets them as a metadata header
instead: the title larger, the rest as labelled values. The information is
still there — nothing is dropped — but it reads as a masthead rather than as
the first thing that went wrong.

## What it deliberately does not do

It is not a YAML parser, and does not pretend to be. It lifts top-level
`key: value` scalars and ignores everything else, which is the 95% case for
document metadata and about a hundredth of the surface of real YAML.

That means the block above works, and this one — which is also legal YAML —
would have its nested parts quietly skipped rather than half-rendered:

```yaml
---
title: A note with structure in its metadata
authors:
  - name: Someone
    email: someone@example.com
  - name: Someone Else
    email: else@example.com
build:
  target: es2022
  strict: true
aliases: [alpha, beta, gamma]
# a comment, which is skipped
---
```

Skipping is the honest failure. Rendering `- name: Someone` as a key called
`- name` would be worse than not showing it, because it would look like
information rather than like a gap.

## The awkward cases

**A very long value.** The `summary` key at the top of this file is one
unbroken line, far wider than any terminal. It wraps against the text column
like a paragraph, with the continuation lines hanging under the value rather
than under the key, so you can still see where one entry ends and the next
begins.

**Non-Latin keys.** `标题`, `作者` and `言語` are all real keys in the block
above. Each of those characters is two cells wide, so the column of values
after them only lines up if the header is measured in display cells. If the
values in this file's header form a straight edge, that measurement is right.

**A key with no value.** An empty value is legal and means "nothing", not
"missing". It should render as a key with nothing after it rather than being
dropped, because a key you wrote and a key you did not are different facts.

**Front matter that is not at the top.** Three hyphens anywhere else in the
file are a horizontal rule, not metadata. Only the very first line can open a
front-matter block:

---

That was a rule, not the start of a second metadata block.

## Ordinary content, from here on

Everything below the closing `---` is a normal document and is parsed normally.
There is no special mode, no residue, and nothing about the front matter
changes how the body is treated.

### A list, to prove it

- Front matter is lifted, not parsed as YAML
- Only top-level scalars survive
- The body starts immediately after the closing delimiter
- [Links still work](README.md), as do [[04-links|wikilinks]]

### A code block, to prove it

```typescript
const FRONT_MATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

export function splitFrontMatter(src: string): {
  frontMatter: FrontMatter | null;
  body: string;
} {
  const m = FRONT_MATTER_RE.exec(src);
  if (!m) return { frontMatter: null, body: src };
  return { frontMatter: scalars(m[1]!), body: src.slice(m[0].length) };
}
```

### A table, to prove it

| Key | Lifted? | Why |
|:---|:---:|:---|
| `title: A note` | yes | a top-level scalar |
| `tags: a, b, c` | yes | a scalar; the commas are just text |
| `标题: 前言` | yes | keys are text, not identifiers |
| `authors:` | no | a mapping, not a scalar |
| `  - name: X` | no | indented, so it belongs to something else |
| `# a comment` | no | a comment is not a key |

## Where to next

That is the end of the tour. Back to the [index](README.md), or start again at
[Basics](01-basics.md).
