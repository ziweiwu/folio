#!/usr/bin/env bash
# The CLI-citizenship checks: everything that has to hold when there is no
# terminal on one end or the other. See I-8, I-11 and I-12.
set -uo pipefail
cd "$(dirname "$0")/.."

# Isolated for the same reason as the pty checks: nothing here should read or
# write the state directory a real reader's positions live in. See I-24.
STATE=$(mktemp -d -t umv-smoke)
export XDG_STATE_HOME="$STATE"
trap 'rm -rf "$STATE"' EXIT

RUN=${RUN:-"npx tsx src/cli.tsx"}
DOC=test/fixtures/kitchen-sink.md
fail=0

ok()   { printf '  ok    %s\n' "$1"; }
bad()  { printf '  FAIL  %s\n' "$1"; fail=1; }
want() { # description, expected exit, command...
  local what=$1 expect=$2; shift 2
  # stdin is always redirected: with no file argument the viewer reads stdin,
  # and an inherited pipe that never closes would hang the run.
  "$@" </dev/null >/dev/null 2>&1
  local got=$?
  [ "$got" -eq "$expect" ] && ok "$what (exit $got)" || bad "$what (expected exit $expect, got $got)"
}

echo "exit status"
want "reads a file"                0 $RUN "$DOC"
want "prints help"                 0 $RUN --help
want "prints version"              0 $RUN --version
want "rejects an unknown option"   2 $RUN --nonsense
want "rejects a bad width"         2 $RUN --width 3
want "reports a missing file"      1 $RUN nope.md

echo "piping"
if $RUN "$DOC" </dev/null | grep -qa $'\033'; then bad "piped output has no escape codes"; else ok "piped output has no escape codes"; fi
if NO_COLOR=1 $RUN "$DOC" </dev/null | grep -qa $'\033'; then bad "NO_COLOR output has no escape codes"; else ok "NO_COLOR output has no escape codes"; fi
if FORCE_COLOR=3 $RUN "$DOC" </dev/null | grep -qa $'\033'; then ok "FORCE_COLOR keeps colour, for less -R"; else bad "FORCE_COLOR keeps colour, for less -R"; fi
if cat "$DOC" | $RUN 2>/dev/null | grep -qa 'Kitchen Sink'; then ok "reads a document from stdin"; else bad "reads a document from stdin"; fi

echo "degrading"
want "survives an empty stdin"     0 $RUN
if $RUN </dev/null >/dev/null 2>&1; then ok "does not crash on redirected stdin"; else bad "does not crash on redirected stdin"; fi
if $RUN --plain "$DOC" </dev/null | grep -qa '☑'; then ok "keeps task state without colour"; else bad "keeps task state without colour"; fi
# Measured in characters, not bytes: box-drawing glyphs are three bytes each,
# so a byte count would flag a perfectly sane 80-column line.
if $RUN "$DOC" </dev/null | python3 -c 'import sys; sys.exit(0 if max((len(l) for l in sys.stdin.read().split("\n")), default=0) <= 80 else 1)'; then
  ok "wraps to 80 columns when there is no terminal"
else
  bad "wraps to 80 columns when there is no terminal"
fi

echo
[ "$fail" -eq 0 ] && echo "smoke tests passed" || echo "smoke tests FAILED"
exit "$fail"
