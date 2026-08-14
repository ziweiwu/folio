# Working on folio

Instructions for Claude Code and any other agent working in this repository.
Read this before changing anything.

## What this is

A terminal markdown viewer. Three pillars, in this order whenever they conflict:

1. **Simplicity** — no configuration file, no plugin system, no modes to learn.
   Weigh every proposed feature against the surface it adds. Cutting scope is a
   valid answer; Org-mode support was deliberately reduced to "render it
   verbatim" on these grounds.
2. **Clarity** — the rendered page should read like a well-set page, and colour
   is always a redundant signal, never the only one.
3. **Speed** — measured, not asserted. Quote real numbers or say nothing.

Keep the runtime dependency count low and visible. It is currently seven.

## The one architectural rule

**Layout runs once per document. Scrolling is an integer.**

`layoutDoc` is a pure function of `(source, width, theme, options)` returning an
array of fully-styled rows. The viewport slices that array. Nothing in the
scroll path may re-run layout, re-parse markdown, or allocate per row — that is
what keeps a 6,246-row document as cheap to draw as a 30-row one.

If a change makes the scroll path do work proportional to document size, it is
the wrong change however convenient it looks.

## Screenshots

`docs/*.png` are in the README, which is what people see on both GitHub and
npm. They are **generated from real frames**, never hand-made, never cropped
from a terminal.

```sh
npm run screenshots     # regenerates all of docs/*.png
```

- **Regenerate them whenever rendering changes** — the theme, the layout engine,
  the chrome, the panes, or anything in `src/ui/`. A screenshot that no longer
  matches the app is worse than no screenshot.
- They are PNG on purpose. npm renders the README from `raw.githubusercontent`,
  which serves SVG as `text/plain`, so an SVG screenshot appears broken on the
  package page.
- README image links must stay **absolute** `raw.githubusercontent.com` URLs.
  Relative paths work on GitHub and break on npm.
- Screenshots come from `scripts/frames.ts`, which the review page shares, so a
  screenshot cannot drift from what the viewer draws. Add a new shot by adding a
  `Spec` to `scripts/gen-png.ts` — do not build frames by hand.

Run `npm run preview:html` and publish `docs/preview.html` when a change needs a
visual sign-off. Colour cannot be reviewed through a terminal transcript.

## Before you say it works

Run all of these. If you did not run them, say so explicitly rather than
implying success.

```sh
npm run typecheck && npm run lint && npm test && npm run build
npm run verify:smoke    # exit status, piping, NO_COLOR, redirected stdin
npm run verify:pty      # a real pty: drive it, signal it, check what it restored
```

`verify:pty` is the one that matters most. A test renderer never touches real
terminal I/O, so it cannot catch a raw-mode crash on launch or an escape
sequence the app forgot to turn off on the way out — and those are the failures
a user actually notices.

## The invariant contract

`INVARIANTS.md` numbers every property this app is built against, and each has a
test whose name starts with its number:

```sh
npx vitest run -t "I-6"     # runs exactly the resize-anchoring guard
```

When you add behaviour worth relying on, add a numbered invariant and a test
carrying its number. When you change behaviour, update the invariant in the same
commit.

## Things that have already bitten

- **`bin` points at compiled output.** `npm link` and the global install run
  `dist/`, so source edits do nothing until `npm run build`.
- **Anything aligned into a column must live in a row's *lead*, not its body.**
  The wrapper collapses runs of whitespace, so padding written into a span is
  silently eaten. This broke front matter and link references.
- **Ink parses one terminal read as one keypress.** A held key arrives as
  `"jjjj"`, so handlers must go through `parseBurst` rather than comparing
  `input === 'j'`.
- **Verification scripts must be hermetic.** They point `XDG_STATE_HOME` at a
  temporary directory. Without that they inherit the reader's saved positions
  and pass or fail according to what was last read.
- **Never measure layout with `String.length`.** Wide CJK and emoji occupy two
  cells, combining marks zero. Use `displayWidth`.

## Releasing

```sh
npm version patch && git push --follow-tags
gh release create vX.Y.Z --generate-notes
```

The `publish` workflow runs the full verification, checks the tag matches
`package.json`, then publishes over OIDC trusted publishing — there is no
`NPM_TOKEN` secret. The trust relationship is bound to the workflow's
**filename**, so renaming `.github/workflows/publish.yml` breaks releases until
it is revoked and recreated.

Regenerate screenshots before cutting a release if rendering changed.

## Commits

- Explain *why*, not just what. The body is where the reasoning goes.
- **Never add a `Co-Authored-By: Claude` or any AI-attribution trailer.**
- Commit or push only when asked.
