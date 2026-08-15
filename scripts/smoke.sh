#!/usr/bin/env bash
# The CLI-citizenship checks: everything that has to hold when there is no
# terminal on one end or the other. See I-8, I-11 and I-12.
set -uo pipefail
cd "$(dirname "$0")/.."

# Isolated for the same reason as the pty checks: nothing here should read or
# write the state directory a real reader's positions live in. See I-24.
STATE=$(mktemp -d "${TMPDIR:-/tmp}/umv-smoke.XXXXXX")
# Templated rather than `-t umv-smoke`, which only BSD mktemp accepts: GNU reads
# the argument as a template and wants at least three X's. It used to fail
# harmlessly here because $STATE was only ever XDG_STATE_HOME, but the checks
# below now write files into it, and an empty $STATE aims those at /.
[ -n "$STATE" ] && [ -d "$STATE" ] || { echo "smoke: could not create a temp dir" >&2; exit 1; }
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

# A table with more columns than the frame can hold defeats the column solver:
# the frame alone costs three cells per column, so shrinking cannot save it.
# The interactive path is protected by the viewport; printing has no viewport
# and has to clamp at the write. See I-30.
WIDE_TABLE="$STATE/wide-table.md"
{
  head=''; sep=''; row=''
  for i in $(seq 0 14); do head="$head|c$i"; sep="$sep|---"; row="$row|$i"; done
  printf '%s|\n%s|\n%s|\n' "$head" "$sep" "$row"
} > "$WIDE_TABLE"
if $RUN --plain "$WIDE_TABLE" </dev/null | python3 -c 'import sys; sys.exit(0 if max((len(l) for l in sys.stdin.read().split("\n")), default=0) <= 80 else 1)'; then
  ok "clamps a table too wide to fit (I-30)"
else
  bad "clamps a table too wide to fit (I-30)"
fi

# A document is content, never instructions: an embedded escape sequence must
# not reach the terminal that is printing it. See I-29.
ESC_DOC="$STATE/escapes.md"
printf '# T\n\nclear: \033[2J\033[H and a bell \007 here\n' > "$ESC_DOC"
if $RUN --plain "$ESC_DOC" </dev/null | grep -qa $'\033'; then
  bad "neutralises escape sequences embedded in a document (I-29)"
else
  ok "neutralises escape sequences embedded in a document (I-29)"
fi

# Downstream leaving early is ordinary Unix behaviour, not a failure. `head`
# closes the pipe as soon as it has its line, and the write still in flight
# then fails with EPIPE — which Node throws by default. See I-32.
if npx tsx src/cli.tsx test/fixtures/large.md 2>"$STATE/epipe.err" | head -1 >/dev/null; then
  if [ -s "$STATE/epipe.err" ]; then
    bad "composes with head without an EPIPE trace (I-32)"
  else
    ok "composes with head without an EPIPE trace (I-32)"
  fi
else
  bad "composes with head without an EPIPE trace (I-32)"
fi
# `grep -q` closes even more abruptly.
if $RUN --plain test/fixtures/large.md 2>/dev/null | grep -qa 'large document'; then
  ok "composes with grep -q (I-32)"
else
  bad "composes with grep -q (I-32)"
fi

# The EPIPE handler exits straight from a stream's error event, which never
# unwinds through `main()`'s `finally { leaveScreen() }`. Restoration must not
# depend on that finally — `screen.ts` also restores from `process.on('exit')`,
# and this is the check that says so. See I-7, I-32.
PROBE="$STATE/exit-probe.mts"
printf "import { enterScreen } from '%s/src/ui/screen.js';\nenterScreen(process.stdout, true);\nprocess.exit(0);\n" "$PWD" > "$PROBE"
PROBE_OUT=$(npx tsx "$PROBE" 2>/dev/null)
if printf '%s' "$PROBE_OUT" | grep -qa "$(printf '\033')\[?1049l" &&
   printf '%s' "$PROBE_OUT" | grep -qa "$(printf '\033')\[?1000l"; then
  ok "restores the terminal on a bare process.exit (I-7)"
else
  bad "restores the terminal on a bare process.exit (I-7)"
fi

echo
[ "$fail" -eq 0 ] && echo "smoke tests passed" || echo "smoke tests FAILED"
exit "$fail"
