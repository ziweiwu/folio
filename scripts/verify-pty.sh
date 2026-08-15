#!/usr/bin/env bash
# Run the viewer under a real pty, drive it, and check what it left behind.
#
# This is the check that matters most. Test renderers never touch real terminal
# I/O, so they cannot catch a raw-mode crash on launch or an escape sequence the
# app forgot to turn off on the way out — and both of those are the failures a
# user actually notices. See I-7 and I-8.
set -uo pipefail
cd "$(dirname "$0")/.."

CMD=${1:-"npx tsx src/cli.tsx test/fixtures/kitchen-sink.md"}
LOG=$(mktemp -t umv-pty)

# Hermetic: the viewer remembers where you were, so a check that inherited the
# real state directory would open a previous run's position instead of the top
# of the document — and pass or fail depending on what you last read. See I-24.
STATE=$(mktemp -d -t umv-state)
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
check() { # name pattern
  if grep -qaF "$2" "$LOG"; then
    printf '  ok    %s\n' "$1"
  else
    printf '  FAIL  %s\n' "$1"
    fail=1
  fi
}
refute() {
  if grep -qaF "$2" "$LOG"; then
    printf '  FAIL  %s\n' "$1"
    fail=1
  else
    printf '  ok    %s\n' "$1"
  fi
}

echo "pty: driving '$CMD'"
# Scroll, half-page, ends, search, next match, contents, help, then quit.
# Typed the way a person types, one key at a time, rather than shipped as a
# single 24-character write. The viewer deliberately refuses a long run of
# different keys arriving in one read — that is how a paste is told apart from
# typing (I-35) — so a driver that sends its whole script at once is testing a
# path no keyboard produces.
{
  for k in j j j j d u ' ' G g / s c r o l l; do printf '%s' "$k"; sleep 0.05; done
  printf '\r'; sleep 0.3
  for k in n n t; do printf '%s' "$k"; sleep 0.15; done
  printf '\r'; sleep 0.3
  printf '?'; sleep 0.3
  printf '\033'; sleep 0.3
  printf 'q'; sleep 0.5
} | script -q "$LOG" bash -c "$CMD" >/dev/null 2>&1

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
LOG3=$(mktemp -t umv-hl)
{ sleep 4; printf 'fff'; sleep 2; printf 'q'; sleep 2; } \
  | script -q "$LOG3" bash -c "npx tsx src/cli.tsx --theme dark test/fixtures/kitchen-sink.md" >/dev/null 2>&1
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
LINKDIR=$(mktemp -d -t umv-link)
printf '# Main\n\nGo to [secret](./secret.md) now.\n' > "$LINKDIR/main.md"
printf '# Secret\n' > "$LINKDIR/secret.md"
chmod 000 "$LINKDIR/secret.md"
LOG4=$(mktemp -t umv-link)
# Tab picks the link, Enter follows it. Then `?` opens the help overlay — which
# only draws if the app is still running — and `q` quits.
#
# Neither "permission denied" nor the alternate-screen reset can tell the two
# outcomes apart: the crash prints the same words in its stack trace, and the
# screen is restored on the way out either way. What separates them is whether
# anything is still there to draw the next frame.
{ sleep 5; printf '\t'; sleep 1; printf '\r'; sleep 2; printf '?'; sleep 2; printf 'q'; sleep 2; } \
  | script -q "$LOG4" bash -c "npx tsx src/cli.tsx $LINKDIR/main.md" >/dev/null 2>&1
if grep -qaF 'permission denied' "$LOG4"; then
  printf '  ok    reports an unreadable link target\n'
else
  printf '  FAIL  reports an unreadable link target\n'
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

echo "signal path"
LOG2=$(mktemp -t umv-sig)
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
descendants() {
  local kid
  for kid in $(pgrep -P "$1" 2>/dev/null); do
    printf '%s ' "$kid"
    descendants "$kid"
  done
}

( sleep 30 | script -q "$LOG2" bash -c "$CMD" >/dev/null 2>&1 ) &
driver=$!

# Wait for the viewer to actually exist rather than guessing how long it needs.
# `script` buffers its typescript, so the log cannot be polled for readiness —
# but the process table can, and a fixed sleep loses the race the moment the
# machine is busy enough for a cold `npx tsx` compile to run long.
# Ready means the viewer has actually entered the alternate screen, which is
# the very thing this check is about to test the restoration of. Polling the
# log for it beats a fixed wait, and beats looking for the process: `script`
# and `npx` both carry `cli.tsx` in their own command lines and are there long
# before the viewer is, so finding one of those and then waiting a few seconds
# is really just a fixed wait wearing a disguise.
started=0
for _ in $(seq 1 80); do
  if grep -qaF "${ESC}[?1049h" "$LOG2"; then started=1; break; fi
  sleep 0.5
done

if [ "$started" -eq 0 ]; then
  printf '  FAIL  the viewer never started\n'
  fail=1
else
  # Mounted, but let the first frame finish before asking it to leave.
  sleep 1
  # Every descendant, because `npx` and `tsx` each wrap the process that
  # actually runs the app, and only the innermost one can restore anything.
  # shellcheck disable=SC2046
  kill -INT $(descendants "$driver") 2>/dev/null
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
if grep -qaF "${ESC}[?2004h" "$LOG2" && ! grep -qaF "${ESC}[?2004l" "$LOG2"; then
  printf '  FAIL  left bracketed paste enabled after SIGINT (I-35)\n'
  fail=1
else
  printf '  ok    restored bracketed paste after SIGINT (I-35)\n'
fi
rm -f "$LOG2"

echo
if [ "$fail" -eq 0 ]; then
  echo "pty verification passed"
else
  echo "pty verification FAILED"
fi
exit "$fail"
