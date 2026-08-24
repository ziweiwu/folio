#!/usr/bin/env bash
# Run the viewer under a real pty, drive it, and check what it left behind.
#
# This is the check that matters most. Test renderers never touch real terminal
# I/O, so they cannot catch a raw-mode crash on launch or an escape sequence the
# app forgot to turn off on the way out — and both of those are the failures a
# user actually notices. See I-7 and I-8.
set -uo pipefail
cd "$(dirname "$0")/.."

# The viewer as it actually ships.
#
# Every check here used to start `npx tsx src/cli.tsx`, which transpiles the
# whole source tree on each of the six viewers this script launches. On a
# developer's machine that is a few seconds; on a loaded macOS CI runner it was
# minutes, and the unreadable-link check spent its entire budget waiting for a
# viewer that had not finished starting — so its keystrokes went to a terminal
# whose raw mode was not yet on, were discarded by the mode switch, and the
# check reported a message missing rather than a viewer absent. The diagnostic
# said so exactly: a frame was drawn, and Tab produced none of the three things
# it can produce.
#
# `bin` points at `dist/` anyway, so this is also the artifact a reader runs —
# the one thing this script exists to exercise. Built here rather than assumed,
# because a stale `dist/` would silently check the previous commit.
npm run build >/dev/null || { echo "pty: build failed" >&2; exit 1; }
VIEWER="node $PWD/dist/cli.js"
CMD=${1:-"$VIEWER test/fixtures/kitchen-sink.md"}
LOG=$(mktemp "${TMPDIR:-/tmp}/umv-pty.XXXXXX")

# Hermetic: the viewer remembers where you were, so a check that inherited the
# real state directory would open a previous run's position instead of the top
# of the document — and pass or fail depending on what you last read. See I-24.
STATE=$(mktemp -d "${TMPDIR:-/tmp}/umv-state.XXXXXX")
export XDG_STATE_HOME="$STATE"

# Every viewer this script starts is a descendant of it, so a single sweep on
# the way out cleans up whatever a timeout or a Ctrl-C left mid-flight. Without
# it an interrupted run leaves an alternate-screen node process running for as
# long as the machine is up — which then competes with the next run and makes
# the timing-sensitive checks below fail for no reason. Matching is by
# descendant, never by name: another folio on this machine is not ours to kill.
reap() {
  local kid
  for kid in $(pgrep -P "$1" 2>/dev/null); do
    reap "$kid"
    kill -9 "$kid" 2>/dev/null
  done
}
trap 'reap $$; rm -rf "$LOG" "$STATE"' EXIT INT TERM

ESC=$'\033'
fail=0

# A real terminal, which is what every check below is about.
#
# `detectColorLevel` returns 0 when TERM is empty or `dumb`, and a GitHub
# runner sets neither TERM nor COLORTERM — so on CI the viewer correctly
# decided there was no colour, and with no colour it does not enable mouse
# reporting at all. Three checks then asserted mouse sequences that the app was
# right not to send, and the highlighting check looked for truecolor tokens
# that cannot exist below level 3. They failed on every CI run since the job
# was added, while passing on any developer's machine, because the difference
# was the environment and not the code. Forcing the level is what makes the
# checks exercise the thing they name.
export FORCE_COLOR=3

# Only this run's own processes are ever signalled. `script` puts the app in a
# new pty session, so its process-group id is no use — but the parent/child
# chain survives, and walking it finds exactly our own app and nothing else.
descendants() {
  local kid
  for kid in $(pgrep -P "$1" 2>/dev/null); do
    printf '%s ' "$kid"
    descendants "$kid"
  done
}
check() { # name pattern
  if grep -qaF "$2" "$LOG"; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n' "$1"
    fail=1
  fi
}
# Whether a marker ever reached the typescript, for a failure to explain itself.
seen() { grep -qaF "$2" "$1" && printf 'yes' || printf 'no'; }

refute() {
  if grep -qaF "$2" "$LOG"; then
    printf '  FAIL  %s\n' "$1"
    fail=1
  else
    printf '  ok    %s\n' "$1"
  fi
}

# Wait for a marker to show up in the typescript a `script` run is writing.
#
# Every `script` here passes -F, and the whole polling design below depends on
# it: without it the typescript is block-buffered, so a marker sits in memory
# until enough output accumulates to flush. An idle viewer produces no further
# output, so the flush never comes, and every `await` runs to its full budget
# while the thing it is waiting for has already happened. Most checks then pass
# anyway — the final greps read the complete file once the run has ended — so
# the breakage showed up only as checks taking two and a half minutes each, and
# as one check whose keystrokes went out minutes after the moment they were
# meant for. -F is the documented flag for watching a live session, which is
# exactly what this script does.
#
# Every drive block below used to open with a fixed sleep and then start typing.
# That is a race with the viewer starting, and on a machine busy enough
# to lose it the whole key script was delivered before the viewer had mounted —
# so the checks failed for reasons that had nothing to do with the app. The
# signal path already polled the log instead, and it was the one that did not
# flake, so the rest now do the same.
await() { # file, pattern, seconds
  local file=$1 pattern=$2 limit=${3:-40} waited=0
  while [ "$waited" -lt "$((limit * 4))" ]; do
    grep -qaF "$pattern" "$file" 2>/dev/null && return 0
    sleep 0.25
    waited=$((waited + 1))
  done
  return 1
}

# One throwaway run, so the module graph is warm in the page cache before
# anything is timed rather than being paid by whichever check goes first.
$VIEWER test/fixtures/kitchen-sink.md >/dev/null 2>&1

echo "pty: driving '$CMD'"
# Scroll, half-page, ends, search, next match, contents, help, then quit.
# Typed the way a person types, one key at a time, rather than shipped as a
# single 24-character write. The viewer deliberately refuses a long run of
# different keys arriving in one read — that is how a paste is told apart from
# typing (I-35) — so a driver that sends its whole script at once is testing a
# path no keyboard produces.
{
  await "$LOG" "${ESC}[?1049h" 60
  for k in j j j j d u ' ' G g / s c r o l l; do printf '%s' "$k"; sleep 0.05; done
  printf '\r'; sleep 0.3
  for k in n n t; do printf '%s' "$k"; sleep 0.15; done
  printf '\r'; sleep 0.3
  printf '?'; sleep 0.3
  printf '\033'; sleep 0.3
  printf 'q'; sleep 0.5
} | script -qF "$LOG" bash -c "$CMD" >/dev/null 2>&1

echo "terminal state"
check   "entered the alternate screen"        "${ESC}[?1049h"
check   "left the alternate screen"           "${ESC}[?1049l"
check   "enabled SGR mouse reporting"         "${ESC}[?1006h"
check   "disabled mouse reporting"            "${ESC}[?1000l"
check   "restored the cursor"                 "${ESC}[?25h"

echo "behaviour"
check   "rendered the document"               "A terminal markdown viewer"
refute  "no raw-mode crash"                   "Raw mode is not supported"
refute  "no unhandled error"                  "at Object."
refute  "no React error boundary output"      "The above error occurred"

echo "syntax highlighting arrives after first paint (I-14)"
LOG3=$(mktemp "${TMPDIR:-/tmp}/umv-hl.XXXXXX")
{ await "$LOG3" "${ESC}[?1049h" 60; printf 'fff'
  # Wait for the highlighted token rather than guessing how long Shiki needs;
  # if it never arrives the check below is the thing that says so.
  #
  # This budget must exceed the mount budget above, not undercut it: the
  # grammars are compiled *after* the viewer mounts, so this marker is always
  # the later of the two. At 30s a cold Shiki load on a loaded machine ran out
  # of budget, the quit below fired before the highlighted frame was ever
  # painted, and the check failed for a reason that had nothing to do with the
  # app. Waiting longer costs nothing when it is fast -- await returns the
  # moment the marker lands, so this only bounds the pathological case.
  await "$LOG3" '38;2;158;206;106' 120
  printf 'q'; sleep 1; } \
  | script -qF "$LOG3" bash -c "$VIEWER --theme dark test/fixtures/kitchen-sink.md" >/dev/null 2>&1
# A code-block background band and a Shiki token colour, neither of which the
# unhighlighted first frame can produce.
if grep -qaF '48;2;28;31;46' "$LOG3" && grep -qaF '38;2;158;206;106' "$LOG3"; then
  printf '  ok    code blocks are highlighted once the grammars load\n'
else
  printf '  FAIL  code blocks are highlighted once the grammars load\n'
  fail=1
fi
rm -f "$LOG3"

echo "a link it cannot read (I-31)"
# `stat` succeeding does not mean a file can be read. Following a link to a
# mode-000 file used to throw out of the host's `open` callback, surface as an
# unhandled rejection, and take the whole viewer down with a blank screen.
LINKDIR=$(mktemp -d "${TMPDIR:-/tmp}/umv-link.XXXXXX")
printf '# Main\n\nGo to [secret](./secret.md) now.\n' > "$LINKDIR/main.md"
printf '# Secret\n' > "$LINKDIR/secret.md"
chmod 000 "$LINKDIR/secret.md"
# The whole check rests on this file being unreadable, and `chmod 000` does not
# achieve that for every user — root reads it regardless. Asserted rather than
# assumed, so an environment that cannot produce an unreadable file says so
# instead of being reported as the viewer failing to notice one.
unreadable=1
if cat "$LINKDIR/secret.md" >/dev/null 2>&1; then unreadable=0; fi
LOG4=$(mktemp "${TMPDIR:-/tmp}/umv-link.XXXXXX")
# Tab picks the link, Enter follows it. Then `?` opens the help overlay — which
# only draws if the app is still running — and `q` quits.
#
# Neither "permission denied" nor the alternate-screen reset can tell the two
# outcomes apart: the crash prints the same words in its stack trace, and the
# screen is restored on the way out either way. What separates them is whether
# anything is still there to draw the next frame.
#
# Driven on a schedule rather than by watching the log, because on the CI
# runner the typescript cannot be read while the run is in progress — not even
# with -F. Measured, not assumed: the alternate screen was found in zero
# seconds and the document's own heading was still missing 84 seconds later, in
# a file that ends up containing the whole session. Every `await` there is
# therefore a delay wearing a marker's clothes.
#
# So the keys are simply sent again. Tab wraps among the one link this document
# has, so it re-selects it; Enter re-follows and the read fails the same way.
# Whichever attempt first lands on a viewer that is ready produces the message,
# and the loop stops as soon as the log shows it on a machine where the log can
# be seen at all. That is what makes this safe against a slow start without
# resting on a fixed sleep being long enough — the objection the header raises,
# and the reason this was written to poll in the first place.
{ await "$LOG4" "${ESC}[?1049h" 60
  for _ in 1 2 3 4 5 6 7 8; do
    printf '\t'; sleep 0.4; printf '\r'
    grep -qaF 'permission denied' "$LOG4" 2>/dev/null && break
    sleep 3
  done
  printf '?'; sleep 2; printf 'q'; sleep 2; } \
  | script -qF "$LOG4" bash -c "$VIEWER $LINKDIR/main.md" >/dev/null 2>&1
if grep -qaF 'permission denied' "$LOG4"; then
  printf '  ok    reports an unreadable link target\n'
elif [ "$unreadable" -eq 0 ]; then
  # Not a failure of the app: this user can read a mode-000 file, so the
  # condition the check needs never existed. Said out loud, because a check
  # that quietly skips itself is indistinguishable from one that passed.
  printf '  SKIP  reports an unreadable link target — this user can read mode 000\n'
else
  printf '  FAIL  reports an unreadable link target\n'
  # Which of the things that had to happen did. Dumping the tail says almost
  # nothing once the escapes are stripped; what separates the failure modes is
  # whether the viewer ever drew at all, whether it found a link to pick, and
  # what it said instead of the message this check wants.
  printf '        drew a frame: %s | reached the target: %s\n' \
    "$(seen "$LOG4" 'q quit')" "$(seen "$LOG4" 'Secret')"
  printf '        said "no links": %s | "press tab": %s | "not found": %s\n' \
    "$(seen "$LOG4" 'no links in this document')" "$(seen "$LOG4" 'press tab')" "$(seen "$LOG4" 'not found')"
  printf '        showed the document: %s\n' "$(seen "$LOG4" 'Main')"
  # The screen as a reader would have seen it: escapes removed rather than
  # merely stripped of their control byte, which leaves `[49m` litter behind
  # and reads as nothing at all.
  printf '        last frame: %s\n' \
    "$(LC_ALL=C sed -e $'s/\033\[[0-9;?]*[a-zA-Z]//g' -e $'s/\033\][^\007]*\007//g' -e 's/[^[:print:]]//g' "$LOG4" | tail -c 400 | tr -s ' ')"
  fail=1
fi
if grep -qaF 'at readFileSync' "$LOG4"; then
  printf '  FAIL  no stack trace escaped to the terminal\n'
  fail=1
else
  printf '  ok    no stack trace escaped to the terminal\n'
fi
if grep -qaF 'reload from disk' "$LOG4"; then
  printf '  ok    still drawing frames afterwards\n'
else
  printf '  FAIL  still drawing frames afterwards\n'
  fail=1
fi
chmod 644 "$LINKDIR/secret.md"
rm -rf "$LOG4" "$LINKDIR"

echo "ctrl-c is an escape hatch from every mode (I-37)"
# In raw mode Ctrl-C is a *byte*, not a signal: the kernel does not turn it
# into SIGINT, so the app itself has to act on it. It only ever did so in the
# doc branch, which left `/` and `t` — a prompt and a full-screen pane, the two
# places a reader can actually feel stuck — with no way out but `q` or `esc`.
#
# The `sleep` after the keystroke is what makes this check mean anything. A
# driver block that ends closes stdin, and a viewer exiting on EOF leaves the
# alternate screen exactly as one that quit does — so without it the log would
# look identical whether or not Ctrl-C did a thing. Held open for far longer
# than the wait below, the only thing that can end the app is the byte itself.
CTRLC_CMD="$VIEWER --no-resume test/fixtures/kitchen-sink.md"
for mode in search:/:▏ contents:t:Contents; do
  label=${mode%%:*}
  rest=${mode#*:}
  opener=${rest%%:*}
  marker=${rest#*:}
  LOG5=$(mktemp "${TMPDIR:-/tmp}/umv-ctrlc.XXXXXX")

  ( { await "$LOG5" "${ESC}[?1049h" 60
      # `--no-resume` below puts the viewer at the top of the document however
      # the earlier runs left it, so its first heading is a marker that is
      # always on screen. The status bar's legend was tried instead, and never
      # reached the typescript on the CI runner within any budget — a styled
      # row runs to hundreds of bytes, and a marker that straddles a write
      # boundary cannot be found by a fixed-string search.
      await "$LOG5" 'A terminal markdown viewer' 60
      printf '%s' "$opener"
      # The mode's own marker, so the byte lands where this check says it does.
      await "$LOG5" "$marker" 30
      printf '\003'
      sleep 600; } | script -qF "$LOG5" bash -c "$CTRLC_CMD" >/dev/null 2>&1 ) &
  driver=$!

  # Leaving the alternate screen is the app tearing itself down, and nothing
  # else can cause it while stdin is held open above.
  #
  # The budget has to exceed everything the driver waits for before it presses
  # anything, because this runs alongside it: at 30s against a cold
  # compile it expired first and killed the run before the mode was ever
  # opened, which reported as "the search never opened" on a busy machine and
  # passed on an idle one. `await` returns the instant its marker lands, so a
  # generous budget only bounds the pathological case.
  left=0
  await "$LOG5" "${ESC}[?1049l" 180 && left=1

  # shellcheck disable=SC2046
  kill -9 $(descendants "$driver") 2>/dev/null
  kill -9 "$driver" 2>/dev/null
  wait "$driver" 2>/dev/null

  if ! grep -qaF "$marker" "$LOG5"; then
    printf '  FAIL  the %s never opened, so ctrl-c from it proves nothing\n' "$label"
    fail=1
  elif [ "$left" -eq 1 ]; then
    printf '  ok    ctrl-c quits from the %s, and restores the terminal\n' "$label"
  else
    printf '  FAIL  ctrl-c quits from the %s, and restores the terminal\n' "$label"
    fail=1
  fi
  rm -f "$LOG5"
done

echo "signal path"
LOG2=$(mktemp "${TMPDIR:-/tmp}/umv-sig.XXXXXX")
# Job control, so the pipeline below becomes a process group of its own and its
# group id is the pid we already have. Signalling that group reaches the app
# inside `script` and nothing else.
#
# It used to be `pkill -f cli.tsx`, which matches every process on the machine
# whose command line contains that string — a reader's own open document, or a
# second copy of this script running beside it. Killing a stranger's process to
# test our own signal handling is not hermetic, and it made this check fail at
# random whenever anything else was running. See I-24.
# Only this run's own processes are signalled. `script` puts the app in a new
# pty session, so the group id is no use — but the parent/child chain survives,
# and walking it finds exactly our own app and nothing else.
# The sleep is only here to hold stdin open so the viewer stays up until it is
# signalled. It must outlast every await below it -- with `sleep 30` against a
# 60s mount budget and a 30s content budget, a slow machine closed stdin first,
# the viewer exited on EOF, and the SIGINT below was delivered to nothing. That
# failed silently as a *pass*, because a clean EOF exit restores the terminal
# too, so the greps still found their bytes. Nothing hangs for this long: the
# whole pipeline is killed explicitly at the end of the check.
( sleep 600 | script -qF "$LOG2" bash -c "$CMD" >/dev/null 2>&1 ) &
driver=$!

# Wait for the viewer to actually exist rather than guessing how long it needs.
# `script` buffers its typescript, so the log cannot be polled for readiness —
# but the process table can, and a fixed sleep loses the race the moment the
# machine is busy enough for a cold start to run long.
# Ready means the viewer has actually entered the alternate screen, which is
# the very thing this check is about to test the restoration of. Polling the
# log for it beats a fixed wait, and beats looking for the process: `script`
# and `npx` both carry `cli.tsx` in their own command lines and are there long
# before the viewer is, so finding one of those and then waiting a few seconds
# is really just a fixed wait wearing a disguise.
started=0
await "$LOG2" "${ESC}[?1049h" 60 && started=1

if [ "$started" -eq 0 ]; then
  printf '  FAIL  the viewer never started\n'
  fail=1
else
  # Mounted is not drawn. Wait for content on the screen before asking it to
  # leave, so the teardown under test is tearing down a running viewer.
  await "$LOG2" "A terminal markdown viewer" 60
  # Every descendant, because `npx` and `tsx` each wrap the process that
  # actually runs the app, and only the innermost one can restore anything.
  targets=$(descendants "$driver")
  # Assert there is something to signal. Without this the check cannot tell a
  # viewer that restored the terminal *because it was interrupted* from one
  # that had already exited on its own and restored it on the way out -- and
  # the second reads as a pass while testing nothing.
  if [ -z "${targets// /}" ]; then
    printf '  FAIL  the viewer was gone before it could be signalled\n'
    fail=1
  fi
  # Unquoted on purpose: this is a list of pids, and each must be its own word.
  # shellcheck disable=SC2086
  kill -INT $targets 2>/dev/null
  for _ in $(seq 1 30); do
    kill -0 "$driver" 2>/dev/null || break
    sleep 0.5
  done
fi

# shellcheck disable=SC2046
kill -9 $(descendants "$driver") 2>/dev/null
kill -9 "$driver" 2>/dev/null
wait "$driver" 2>/dev/null

if ! grep -qaF "${ESC}[?1049h" "$LOG2"; then
  printf '  FAIL  app never reached the alternate screen\n'
  fail=1
elif grep -qaF "${ESC}[?1049l" "$LOG2" && grep -qaF "${ESC}[?1000l" "$LOG2"; then
  printf '  ok    restored the terminal after SIGINT\n'
else
  printf '  FAIL  restored the terminal after SIGINT\n'
  fail=1
fi

# Bracketed paste is requested through Ink, which only turns it off when React
# unmounts — and a signal handler exits long before that. Checked separately
# from the line above because it is a different owner and a different failure:
# the reader gets their shell back, but every paste into it arrives wrapped in
# `\e[200~`. See I-7, I-35.
# The *last* toggle is what the reader is left with, so asking merely whether a
# `?2004l` appears anywhere would pass on a log that enabled paste again after
# disabling it. This reads the ordered toggles and checks the one that wins.
paste_final=$(perl -0777 -ne 'my $last = ""; while (/\e\[\?2004([hl])/g) { $last = $1 } print $last' "$LOG2")
if [ "$paste_final" = "h" ]; then
  printf '  FAIL  left bracketed paste enabled after SIGINT (I-35)\n'
  fail=1
elif [ "$paste_final" = "l" ]; then
  printf '  ok    restored bracketed paste after SIGINT (I-35)\n'
else
  printf '  ok    bracketed paste was never enabled (I-35)\n'
fi
rm -f "$LOG2"

echo
if [ "$fail" -eq 0 ]; then
  echo "pty verification passed"
else
  echo "pty verification FAILED"
fi
exit "$fail"
