---
paths:
  - "scripts/**"
  - "test/**"
---

# Verification-script traps

`scripts/smoke.sh` and `scripts/verify-pty.sh` are the checks a user's failures
actually show up in. Each rule below exists because a check once passed while
the thing it named was broken.

- **Verification scripts must be hermetic.** They point `XDG_STATE_HOME` at a
  temporary directory. Without that they inherit the reader's saved positions
  and pass or fail according to what was last read. (I-24)
- **The shell scripts run on GNU too.** `verify:smoke` is a CI job on
  ubuntu-latest, and BSD-only syntax passes locally and fails only there.
  `mktemp -t name` is the one that bit: GNU reads the argument as a template and
  rejects it for having no `X`s, so the variable came back empty and the checks
  wrote to `/`. Pass a real template — `mktemp -d "${TMPDIR:-/tmp}/x.XXXXXX"` —
  and assert you got a path back.
- **Never open a pty check with a fixed sleep.** A cold `npx tsx` compile can
  outlast any sleep you pick, and the keys then arrive before the viewer has
  mounted — which fails the check for a reason that has nothing to do with the
  app, but only on a busy machine. Poll the typescript for a marker instead:
  `await "$LOG" "$ESC[?1049h"` for mounted, and the thing under test for done.
- **Assert the state a check leaves behind, not that a byte appeared.** Asking
  whether `?2004l` occurs anywhere in a log passes on a run that turned the mode
  back on afterwards. Read the ordered toggles and check the last one.
- **A check must not be able to pass without exercising what it names.** The
  SIGINT check held the viewer's stdin open with `sleep 30` while the `await`s
  before the signal were allowed 90s. On a slow machine stdin closed first, the
  viewer exited on EOF, and the signal went to nothing — but a clean exit
  restores the terminal too, so the greps still found their bytes and it
  reported *ok*. A fixed sleep bounding a process's lifetime is the same trap as
  one bounding its readiness. Give the holder more time than every wait beneath
  it can consume, and assert the thing under test is still alive at the moment
  you act on it.
- **A later marker needs a longer budget than the one before it.** Waiting for
  Shiki's highlighted token got 30s where mounting got 60, though the grammars
  compile strictly after the mount. `await` returns the instant its marker
  lands, so a generous budget is free on a fast machine and only bounds the
  pathological case.

- **Under `pipefail`, never pipe a command that exits non-zero by design into
  `grep`.** The pipeline reports the *command's* status, not grep's, so
  `folio missing.md | grep -q 'no such file'` fails even when the message is
  exactly right — and it fails as "the message was wrong", which sends you
  looking in the wrong place. Capture first, match after:
  `out=$(cmd 2>&1 >/dev/null); case $out in *"$want"*) ok;; esac`.
- **On the GitHub macOS runner the typescript cannot be read while the run is
  in progress**, `script -F` notwithstanding. Measured: the alternate-screen
  sequence was found in zero seconds and the document's own heading was still
  missing 84 seconds later, in a file that ends up holding the whole session.
  Every `await` there is a delay wearing a marker's clothes, and most checks
  pass anyway because the greps that decide them run after the pipeline ends.
  The exception is a check whose *keystroke timing* is load bearing — that one
  must drive rather than watch: send the keys again on a schedule until the
  effect appears, so a slow start costs another attempt instead of the run.
  Pass -F regardless; it is what makes the polling work everywhere else, and it
  took the whole script from five minutes to thirty seconds.
- **A concurrent wait must outlast everything the driver waits for.** A check
  whose driver block polls for the mount and then for content, while the
  assertion polls for the result on a shorter budget, kills the run before the
  keystroke under test is ever sent. The failure reads as "the mode never
  opened" and only on a busy machine. Every budget must exceed the sum of the
  ones that must elapse before its marker can appear.
- **An earlier check leaves state the next one inherits.** The viewer saves a
  reading position on `q`, so a later check that waits for the document's
  *first line* waits forever — the run resumed halfway down. Wait for something
  the frame always draws, such as the status bar's own legend, and pass
  `--no-resume` when the keystrokes depend on where the reader is.

When you add behaviour worth relying on, add a numbered invariant to
`INVARIANTS.md` and a test carrying its number.
