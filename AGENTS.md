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
npm run screenshots           # regenerates all of docs/*.png
npm run verify:screenshots    # are they still current?
```

`screenshots` needs Chrome or Chromium to rasterise; it looks in the usual
places on macOS and Linux, and `$CHROME` overrides. `verify:screenshots` needs
neither — it compares frames, which is why CI can run it on any runner.

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
  `Spec` to `SHOTS` in `scripts/frames.ts` — do not build frames by hand.
- `npm run screenshots` also writes `docs/frames.sha256`, a digest of the frames
  as the app drew them. `verify:screenshots` recomputes it, so CI catches a
  rendering change that forgot the screenshots. It hashes the frames rather than
  the PNGs on purpose: rasterisation differs between a laptop and a runner, so
  comparing image bytes would fail for reasons that have nothing to do with the
  app.

Run `npm run preview:html` and publish `docs/preview.html` when a change needs a
visual sign-off. Colour cannot be reviewed through a terminal transcript.

## Before you say it works

Run all of these. If you did not run them, say so explicitly rather than
implying success.

```sh
npm run typecheck && npm run lint && npm test && npm run build
npm run verify:smoke          # exit status, piping, NO_COLOR, redirected stdin
npm run verify:screenshots    # docs/*.png still match what the app draws
npm run verify:pty            # a real pty: drive it, signal it, check what it restored
```

Everything but `verify:pty` also runs as a `Stop` hook, so a turn that leaves
the tree failing is refused rather than summarised. The hook skips when nothing
under `src/`, `test/`, `scripts/` or the manifests has changed, and blocks at
most once per tree state so a failure it cannot fix never traps the session.
`verify:pty` is excluded there because it is minutes long and needs a real pty —
CI carries it on a macOS runner instead.

The hook itself is no longer in this repo. It lives in the `harness` plugin
(`plugins/harness/hooks/verify-gate.py` in the agent checkout) and reads its
list from **`.claude/gates.json`** here — `watch` pathspecs, `gates` as
`[name, argv]` pairs, and a per-gate `timeout`. It began as this repo's own
`.claude/hooks/verify-gate.py`, which worked well enough to be worth every repo
having and was reachable by exactly one; generalising it cost only moving the
npm-script names into that file. A repo with no `gates.json` gets nothing, which
is what keeps a Stop hook that runs a test suite from firing everywhere.

`watch` entries are git pathspecs, not prefixes — git matches whole path
components, so the manifests are spelled out individually. A lockfile change is
the one most likely to break the build and the easiest to leave off the list.

`verify:pty` is the one that matters most. A test renderer never touches real
terminal I/O, so it cannot catch a raw-mode crash on launch or an escape
sequence the app forgot to turn off on the way out — and those are the failures
a user actually notices.

It builds first and drives `dist/cli.js`, not `src/` through `tsx`. That is the
artifact `bin` points at, so it is the one worth driving — and it starts in a
fraction of the time, which stopped mattering as a nicety the moment a loaded
CI runner spent a whole check's budget waiting for a viewer that had not
finished transpiling, and reported the app as silent.

Most of it drives the viewer through `script(1)` and reads the typescript it
writes. One check — following a link the filesystem refuses, `scripts/pty-link.py`
— opens its own pty instead, because it has to *react* to what is on screen
rather than only send keys at it, and on the macOS CI runner a typescript
cannot be read while the run is in progress. Both are hermetic the same way,
pointing `XDG_STATE_HOME` at a temporary directory (I-24).

## The example documents

`examples/` is nine documents covering every markdown construct the viewer
draws, with `examples/README.md` as an index whose relative links resolve, so
`folio examples/README.md` is a working tour of link following.

They are demonstration documents first and fixtures second: the prose in them is
real, because a viewer that only looks right on lorem ipsum has not been tested.
They are also the widest net there is for display-width bugs — the joined-emoji
mis-measurement behind I-2 was found by rendering `examples/07-unicode.md` and
noticing a table column that would not line up.

Keep the relative links resolving. `examples/04-links.md` carries one
deliberately broken link, labelled as such in its own prose; that one is the
exception and must stay broken.

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

The rest are scoped to where they apply, so they load when you open the file
rather than in every session:

- `.claude/rules/rendering.md` — `src/**`: lead-not-body alignment, `parseBurst`
  for held keys, `displayWidth` instead of `String.length`.
- `.claude/rules/verification.md` — `scripts/**` and `test/**`: hermetic state,
  GNU-compatible `mktemp`, never a fixed sleep, assert the state a check leaves
  behind.

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
