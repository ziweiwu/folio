# folio invariants

The contract this viewer is built against. Every invariant is numbered and has
at least one test whose name starts with its number, so the mapping is
mechanically checkable:

```
npx vitest run -t "I-1"
```

Eight of them — I-7, I-12, I-14, I-17, I-23, I-30, I-31 and I-32 — are enforced by the
scripts under `scripts/` rather than by unit tests, because they are about real
terminal and process behaviour that a test renderer cannot exercise. I-8, I-11
and I-29 are covered both ways.

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
| I-25 | An overlay is drawn at every terminal size or not at all — it never throws and never overruns the frame. A pane is sized from a terminal that may be narrower than the smallest drawable box, so its geometry is clamped and the composite is clipped to the frame's width | `ui/panes.ts` · `ui/overlay.ts` · `test/viewport.test.ts` |
| I-26 | A row the viewport cannot show in full always says so, with `›` at the edge it runs past — in the frame and in one-shot output alike. The mark claims only what is true of every case, that the row continues; pressing `l` is what distinguishes a row that can move from one that cannot, and the status bar's `↔` says when the viewport has moved. That indicator outranks the hints, because a legend is available from `?` at any time and live state is not. The mark is never an ellipsis: with colour stripped that is byte-identical to one the author typed, and a mark that exists only in colour is no mark at all | `ui/chrome.ts` · `cli.tsx` · `test/overflow.test.ts` · `test/viewport.test.ts` |
| I-27 | Every theme colour carrying **text** meets WCAG AA 4.5:1 against the ground it is drawn on, in both themes; marks that are only structural meet 3:1. Colour that cannot be read is not a redundant signal, it is a missing one. The scrollbar *track* is the one deliberate exemption — it is a rail behind the thumb, and both the thumb and the percentage in the status bar carry the position without it | `ui/theme.ts` · `test/theme.test.ts` |

## Terminal safety

| # | Invariant | Where |
|---|---|---|
| I-7 | The alternate screen, the cursor, mouse reporting and bracketed paste are restored on **every** exit path — normal return, `q`, Ctrl-C, SIGINT/SIGTERM/SIGHUP, and an unhandled throw. Restoration is idempotent, and the teardown owns all four rather than leaving any to a framework: bracketed paste is requested through Ink, which only turns it off when React unmounts, and a signal handler exits before that — leaving the reader a shell that wraps every paste in `\e[200~` | `ui/screen.ts` · `scripts/verify-pty.sh` |
| I-8 | Raw mode is never requested unless there is a terminal on both ends. A pipe on stdin borrows `/dev/tty` for keys, or falls back to printing | `cli.tsx` · `scripts/smoke.sh` |
| I-31 | A failure in a callback the host supplied becomes a status message, never a crash. `stat` succeeding does not mean a file can be read, so following a link may reject after the viewer has already committed to it — and a rejection React cannot render takes the whole viewer down with a blank screen | `app.tsx` · `cli.tsx` · `scripts/verify-pty.sh` |

## Cost and responsiveness

| # | Invariant | Where |
|---|---|---|
| I-9 | A held scroll key applies immediately, then produces at most one further update per 16 ms frame. Thirty queued keystrokes become two updates, not thirty | `core/coalesce.ts` · `test/viewport.test.ts` |
| I-10 | The viewport composes exactly `rows` rows whatever the document's size, and every row is padded to the full width so no part of the previous frame shows through | `ui/chrome.ts` · `test/viewport.test.ts` |
| I-14 | First paint never waits for syntax highlighting. The document is drawn unhighlighted and replaced when the grammars are ready — the 95 ms of highlighting in a 200-code-block document costs nothing at open | `cli.tsx` · `app.tsx` · `scripts/verify-pty.sh` |
| I-34 | A keystroke sees what the keystroke before it chose, and a chunk holding several keys is applied as all of them. Every value the handler branches on — the mode, the query, the search and link cursors, the contents cursor — is read from a ref that is current the instant a key changes it, never from state a frame behind. And Ink does not split `⇥` or `⏎` out of a chunk the way it splits backspace, because both can appear in pasted text, so a chunk containing one is handled by inspecting the chunk rather than by trusting `key.tab`/`key.return`. Otherwise `/cat` then `q` quits the viewer, `jjjj⏎` in the contents picks the heading it started on, `⇥⏎` never follows a link, and a query typed fast is never run | `app.tsx` · `test/app.test.tsx` |
| I-35 | Pasted text is content, never commands. Bracketed paste is requested so the terminal itself says which chunks are pastes, and those go to their own handler — into the query when the search box is open, and otherwise refused with a note. That is the lock. A chunk of more than eight *different* keys is additionally never taken for typing, which catches a pasted sentence or command on a terminal too old to bracket it; it is a partial mitigation, not a second lock, and by construction does not cover a paste under that length, one key repeating, or a paste split across reads. Closing those would mean rejecting real fast typing | `app.tsx` · `core/keys.ts` · `test/app.test.tsx` · `test/viewport.test.ts` |
| I-15 | A chunk of ordinary keys means the keystrokes it spells, applied in order. Ink parses one read as one keypress, so `jjjj`, `jd`, `/cat⏎`, `⇥⏎` and `tjjjj⏎` all arrive as a single string — each must do what pressing those keys does, not be dropped as unrecognised. A run of one key stays one keystroke with a repeat count, so a held toggle does not flicker and `//` is not a search for a slash. A chunk carrying an escape sequence is never split into its bytes: an arrow is one keypress spelled in several. Only printable text ever reaches the query | `core/keys.ts` · `app.tsx` · `test/viewport.test.ts` · `test/app.test.tsx` |

## Navigation and state

| # | Invariant | Where |
|---|---|---|
| I-20 | A link's target is carried on the row in **every** link mode. Whether the terminal can make links clickable is a display setting, and following one must not depend on it | `md/inline.ts` · `core/wrap.ts` · `test/links.test.ts` |
| I-21 | A remembered reading position is a **block index**, not a row. Rows depend on the terminal's width, so a position saved in a wide window would land somewhere else in a narrow one | `core/positions.ts` · `test/state.test.ts` |
| I-33 | Only the newest reload may change the document. An editor that writes a file twice on one save fires two changes, and nothing orders their reads — so a reload that finishes after a later one has started is discarded rather than allowed to restore stale text under a "reloaded" note | `app.tsx` · `test/app.test.tsx` |
| I-22 | An unreadable or corrupt position store is treated as empty, never as an error. Remembering where you were is a convenience; losing it costs one keypress | `core/positions.ts` · `test/state.test.ts` |
| I-24 | The verification scripts are hermetic: they point `XDG_STATE_HOME` at a temporary directory, so they neither read nor write the positions a real reader has accumulated. A check that inherits saved state passes or fails according to what was last read | `scripts/verify-pty.sh` · `scripts/smoke.sh` |
| I-28 | Every match the search counts is reachable. `n` pressed as many times as there are matches visits each exactly once and returns to the start, including several matches on one row — stepping is by match, never by row offset | `core/search.ts` · `app.tsx` · `test/viewport.test.ts` |
| I-23 | Copying is reported as *sent*, never as *copied*. OSC 52 is advisory — the terminal may silently refuse — so the message must not claim more than actually happened | `core/clipboard.ts` · `app.tsx` |

## CLI citizenship

| # | Invariant | Where |
|---|---|---|
| I-11 | Piped output carries no escape codes and no trailing whitespace. `NO_COLOR` is fully readable: headings keep their rules, tasks their boxes, code its frame. Colour is never the only encoding | `md/layout.ts` · `test/layout.test.ts` · `scripts/smoke.sh` |
| I-12 | Redirected or empty stdin degrades to one-shot output and exits 0. It never crashes | `cli.tsx` · `scripts/smoke.sh` |
| I-13 | An unknown fence language, a grammar the JavaScript regex engine cannot compile, or any highlighter failure degrades **that one code block** to plain text. It never blanks the block or crashes the app | `md/highlight.ts` · `test/layout.test.ts` |
| I-17 | Exit status is 0 for success, 1 for a document that could not be read, 2 for bad usage. Errors state the cause and the remedy | `cli.tsx` · `scripts/smoke.sh` |
| I-29 | A control byte in a document is content, never an instruction. C0 bytes and DEL are shown in caret notation before anything parses them, so a file cannot clear the screen, forge an OSC 8 target, ring the bell, or overwrite the row just drawn. The same rule applies to a filename printed as chrome | `core/sanitize.ts` · `test/layout.test.ts` · `scripts/smoke.sh` |
| I-32 | A reader that stops reading is not an error. `folio doc.md \| head -1` closes the pipe mid-write; EPIPE means the job is done and exits 0, while any other write failure is still reported. Composing with `head`, `grep -q` and a quit `less` is the documented promise | `cli.tsx` · `scripts/smoke.sh` |
| I-30 | One-shot output is clamped to the terminal's width. The interactive frame is guaranteed by the viewport; printing has no viewport, so it clamps at the write — a table with more columns than the frame can hold is cut with a mark, never printed past the edge | `cli.tsx` · `scripts/smoke.sh` |

## Running the checks

```sh
npm test              # 351 unit and property tests
npm run lint
npm run typecheck
npm run build
npm run verify:smoke  # I-8, I-11, I-12, I-17 — the no-terminal paths
npm run verify:pty    # I-7, I-8 — a real pty, driven and then killed
```
