---
paths:
  - "src/**"
---

# Rendering and layout traps

These have already cost a debugging session each. They apply to anything under
`src/`.

- **Anything aligned into a column must live in a row's *lead*, not its body.**
  The wrapper collapses runs of whitespace, so padding written into a span is
  silently eaten. This broke front matter and link references.
- **Ink parses one terminal read as one keypress.** A held key arrives as
  `"jjjj"`, so handlers must go through `parseBurst` rather than comparing
  `input === 'j'`.
- **Never measure layout with `String.length`.** Wide CJK and emoji occupy two
  cells, combining marks zero. Use `displayWidth`.

Remember the one architectural rule while you are in here: layout runs once per
document, scrolling is an integer. Nothing in the scroll path may re-run layout,
re-parse markdown, or allocate per row.
