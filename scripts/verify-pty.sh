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
trap 'rm -f "$LOG"' EXIT

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
printf 'jjjjdu G g /scroll\rnnt\r?\033q' | script -q "$LOG" bash -c "$CMD" >/dev/null 2>&1

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

echo "signal path"
LOG2=$(mktemp -t umv-sig)
( sleep 30 | script -q "$LOG2" bash -c "$CMD" >/dev/null 2>&1 ) &
driver=$!

# A fixed wait, not a poll of the log: `script` buffers its typescript, so the
# alternate-screen sequence is not visible in the file until it flushes. Six
# seconds is generous for `npx tsx` to compile and mount.
sleep 6
pkill -INT -f 'cli.tsx' 2>/dev/null
for _ in $(seq 1 20); do
  kill -0 $driver 2>/dev/null || break
  sleep 0.5
done
kill -9 $driver 2>/dev/null
pkill -9 -f 'cli.tsx' 2>/dev/null

if ! grep -qaF "${ESC}[?1049h" "$LOG2"; then
  printf '  FAIL  app never reached the alternate screen\n'
  fail=1
elif grep -qaF "${ESC}[?1049l" "$LOG2" && grep -qaF "${ESC}[?1000l" "$LOG2"; then
  printf '  ok    restored the terminal after SIGINT\n'
else
  printf '  FAIL  restored the terminal after SIGINT\n'
  fail=1
fi
rm -f "$LOG2"

echo
if [ "$fail" -eq 0 ]; then
  echo "pty verification passed"
else
  echo "pty verification FAILED"
fi
exit "$fail"
