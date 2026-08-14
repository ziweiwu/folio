# folio invariants

The contract this viewer is built against. Every invariant is numbered and has
at least one test whose name starts with its number, so the mapping is
mechanically checkable:

```
npx vitest run -t "I-1"
```

Five of them — I-7, I-12, I-14, I-17 and I-23 — are enforced by the scripts under
`scripts/` rather than by unit tests, because they are about real terminal and
process behaviour that a test renderer cannot exercise. I-8 and I-11 are
covered both ways.

## Rendering and layout

| # | Invariant | Where |
|---|---|---|
| I-1 | No rendered row exceeds the terminal width in **display cells**. Checked for every fixture at 40, 60, 80, 100, 160 and 200 columns, with and without a text-column cap | `md/layout.ts` · `test/layout.test.ts` |
| I-2 | Layout measures display cells, never `String.length`. CJK and emoji are two cells, combining marks zero, and `U+FE0F` widens the glyph before it. A slice never separates a base glyph from its marks | `core/width.ts` · `core/ansi.ts` · `test/layout.test.ts` · `test/ansi.test.ts` |
| I-3 | `layoutDoc` is a pure function of (source, width, theme, options). Same inputs, byte-identical rows | `md/layout.ts` · `test/layout.test.ts` |
| I-4 | Scrolling never re-runs layout. Composing a frame is >20x cheaper than laying the document out — **0.10 ms** per frame against **135 ms** to lay out a 6,246-row document | `ui/chrome.ts` · `test/viewport.test.ts` |
| I-5 | The offset is always in `[0, max(0, rows - height)]`. An empty document and one shorter than the viewport are both valid | `core/position.ts` · `test/viewport.test.ts` |
| I-6 | A resize re-anchors to the block that was at the top of the viewport, so the reader keeps their place instead of being thrown to the top | `core/position.ts` · `app.tsx` · `test/viewport.test.ts` |
| I-16 | Anything aligned into a column lives in the row's lead, not its body. The wrapper collapses runs of whitespace, so padding written into a span would not survive it | `md/layout.ts` · `test/layout.test.ts` |
| I-18 | A composed frame is exactly the terminal's width in both overflow modes, at any horizontal offset. Layout may emit rows wider than the screen in `scroll` mode; the viewport is what guarantees the frame | `ui/chrome.ts` · `test/overflow.test.ts` |
| I-19 | Only rows laid out at their natural width move sideways. Prose is already wrapped to fit, so shifting it would push it off screen for nothing — and a reader scrolling to see a command should not lose the paragraph explaining it | `ui/chrome.ts` · `test/overflow.test.ts` |

## Terminal safety

| # | Invariant | Where |
|---|---|---|
| I-7 | The alternate screen, the cursor and mouse reporting are restored on **every** exit path — normal return, `q`, Ctrl-C, SIGINT/SIGTERM/SIGHUP, and an unhandled throw. Restoration is idempotent | `ui/screen.ts` · `scripts/verify-pty.sh` |
| I-8 | Raw mode is never requested unless there is a terminal on both ends. A pipe on stdin borrows `/dev/tty` for keys, or falls back to printing | `cli.tsx` · `scripts/smoke.sh` |

## Cost and responsiveness

| # | Invariant | Where |
|---|---|---|
| I-9 | A held scroll key applies immediately, then produces at most one further update per 16 ms frame. Thirty queued keystrokes become two updates, not thirty | `core/coalesce.ts` · `test/viewport.test.ts` |
| I-10 | The viewport composes exactly `rows` rows whatever the document's size, and every row is padded to the full width so no part of the previous frame shows through | `ui/chrome.ts` · `test/viewport.test.ts` |
| I-14 | First paint never waits for syntax highlighting. The document is drawn unhighlighted and replaced when the grammars are ready — the 95 ms of highlighting in a 200-code-block document costs nothing at open | `cli.tsx` · `app.tsx` · `scripts/verify-pty.sh` |
| I-15 | A key-repeat burst is applied as the keystrokes it represents. Ink parses one read as one keypress, so `jjjj` must move four lines, not be dropped as unrecognised | `core/keys.ts` · `test/viewport.test.ts` |

## Navigation and state

| # | Invariant | Where |
|---|---|---|
| I-20 | A link's target is carried on the row in **every** link mode. Whether the terminal can make links clickable is a display setting, and following one must not depend on it | `md/inline.ts` · `core/wrap.ts` · `test/links.test.ts` |
| I-21 | A remembered reading position is a **block index**, not a row. Rows depend on the terminal's width, so a position saved in a wide window would land somewhere else in a narrow one | `core/positions.ts` · `test/state.test.ts` |
| I-22 | An unreadable or corrupt position store is treated as empty, never as an error. Remembering where you were is a convenience; losing it costs one keypress | `core/positions.ts` · `test/state.test.ts` |
| I-24 | The verification scripts are hermetic: they point `XDG_STATE_HOME` at a temporary directory, so they neither read nor write the positions a real reader has accumulated. A check that inherits saved state passes or fails according to what was last read | `scripts/verify-pty.sh` · `scripts/smoke.sh` |
| I-23 | Copying is reported as *sent*, never as *copied*. OSC 52 is advisory — the terminal may silently refuse — so the message must not claim more than actually happened | `core/clipboard.ts` · `app.tsx` |

## CLI citizenship

| # | Invariant | Where |
|---|---|---|
| I-11 | Piped output carries no escape codes and no trailing whitespace. `NO_COLOR` is fully readable: headings keep their rules, tasks their boxes, code its frame. Colour is never the only encoding | `md/layout.ts` · `test/layout.test.ts` · `scripts/smoke.sh` |
| I-12 | Redirected or empty stdin degrades to one-shot output and exits 0. It never crashes | `cli.tsx` · `scripts/smoke.sh` |
| I-13 | An unknown fence language, a grammar the JavaScript regex engine cannot compile, or any highlighter failure degrades **that one code block** to plain text. It never blanks the block or crashes the app | `md/highlight.ts` · `test/layout.test.ts` |
| I-17 | Exit status is 0 for success, 1 for a document that could not be read, 2 for bad usage. Errors state the cause and the remedy | `cli.tsx` · `scripts/smoke.sh` |

## Running the checks

```sh
npm test              # 192 unit and property tests
npm run lint
npm run typecheck
npm run build
npm run verify:smoke  # I-8, I-11, I-12, I-17 — the no-terminal paths
npm run verify:pty    # I-7, I-8 — a real pty, driven and then killed
```
