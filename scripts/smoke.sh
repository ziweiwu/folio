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
[ -n "$STATE" ] && [ -d "$STATE" ] || { echo "smoke: hermetic state dir (I-24) could not be created" >&2; exit 1; }
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

echo "exit status (I-17)"
want "reads a file"                0 $RUN "$DOC"
want "prints help"                 0 $RUN --help
want "prints version"              0 $RUN --version
want "rejects an unknown option"   2 $RUN --nonsense
want "rejects a bad width"         2 $RUN --width 3
want "reports a missing file"      1 $RUN nope.md

echo "piping"
if $RUN "$DOC" </dev/null | grep -qa $'\033'; then bad "piped output has no escape codes (I-11)"; else ok "piped output has no escape codes (I-11)"; fi
if NO_COLOR=1 $RUN "$DOC" </dev/null | grep -qa $'\033'; then bad "NO_COLOR output has no escape codes (I-11)"; else ok "NO_COLOR output has no escape codes (I-11)"; fi
if FORCE_COLOR=3 $RUN "$DOC" </dev/null | grep -qa $'\033'; then ok "FORCE_COLOR keeps colour, for less -R"; else bad "FORCE_COLOR keeps colour, for less -R"; fi
if cat "$DOC" | $RUN 2>/dev/null | grep -qa 'Kitchen Sink'; then ok "reads a document from stdin (I-8)"; else bad "reads a document from stdin (I-8)"; fi

echo "degrading"
want "survives an empty stdin"     0 $RUN
if $RUN </dev/null >/dev/null 2>&1; then ok "does not crash on redirected stdin (I-12)"; else bad "does not crash on redirected stdin (I-12)"; fi
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

# A file whose layout is its meaning must not go through the markdown parser.
# Markdown joins a run of non-blank lines into one paragraph, so a source file
# came out with every indent gone and its comments promoted to headings — the
# viewer silently rewriting the file it was asked to show. See I-38.
SRC_DOC="$STATE/indented.py"
printf '# a comment\ndef load(path):\n    with open(path) as f:\n        return f.read()\n' > "$SRC_DOC"
if $RUN --plain "$SRC_DOC" </dev/null | grep -qa '^ *with open(path) as f:$'; then
  ok "shows a source file verbatim, indentation intact (I-38)"
else
  bad "shows a source file verbatim, indentation intact (I-38)"
fi
# The same file under --markdown still parses, so the override is not lost.
if $RUN --plain --markdown "$SRC_DOC" </dev/null | grep -qa 'with open(path) as f: return f.read()'; then
  ok "--markdown still forces the parser (I-38)"
else
  bad "--markdown still forces the parser (I-38)"
fi

# A path that is not a readable document is refused with the cause *and* the
# remedy, rather than rendered as junk or reported as a raw errno string. A
# directory used to print `EISDIR: illegal operation on a directory, read`, and
# a PNG used to print screens of caret notation. See I-17, I-39.
# Captured rather than piped into grep: these commands exit non-zero by
# design, and under `pipefail` a pipeline reports that exit even when grep
# found what it was looking for — so piping would report every one of these as
# a failure whatever the message said.
says() { # description, expected text, command...
  local what=$1 expect=$2; shift 2
  local got
  got=$("$@" </dev/null 2>&1 >/dev/null)
  case $got in
    *"$expect"*) ok "$what" ;;
    *) bad "$what (said: ${got:-nothing})" ;;
  esac
}

want "refuses a directory" 1 $RUN "$STATE"
says "says a directory is a directory (I-39)" 'is a directory' $RUN "$STATE"

BIN_DOC="$STATE/binary.bin"
printf 'PNG\r\n\032\n\000\000\000\015IHDR\000\000\001' > "$BIN_DOC"
want "refuses a binary file" 1 $RUN "$BIN_DOC"
says "says a binary file is binary (I-39)" 'binary, not text' $RUN "$BIN_DOC"

# Binary on stdin is the same answer: the check is on the bytes, not the path.
STDIN_SAID=$(cat "$BIN_DOC" | $RUN 2>&1 >/dev/null)
case $STDIN_SAID in
  *'binary, not text'*) ok "refuses binary arriving on stdin (I-39)" ;;
  *) bad "refuses binary arriving on stdin (I-39)" ;;
esac

# A crafted document must not be able to kill the viewer. `marked`'s lexer is
# quadratic in list nesting, and at five thousand levels it aborts the process
# with a heap exhaustion no `try`/`catch` can intercept — so the guard has to
# be checked end to end, at the exit status, which is the only place the
# difference between "shown verbatim" and "SIGABRT" is visible. See I-40.
NEST_DOC="$STATE/deepnest.md"
python3 -c "
import sys
sys.stdout.write('\n'.join(' ' * i + '- item%d' % i for i in range(5000)))
" > "$NEST_DOC"
want "survives a pathologically nested document (I-40)" 0 $RUN --plain "$NEST_DOC"
# Verbatim loses no text: the last item is still there.
if $RUN --plain "$NEST_DOC" </dev/null | grep -qa 'item4999'; then
  ok "keeps every line of it (I-40)"
else
  bad "keeps every line of it (I-40)"
fi
# And --markdown cannot force the parse that would abort.
want "--markdown cannot override the nesting guard (I-40)" 0 $RUN --plain --markdown "$NEST_DOC"

# A flag that cannot be honoured is said out loud rather than dropped: without
# a terminal there is nothing for --watch to redraw, and it used to be accepted
# and silently ignored.
WATCH_SAID=$($RUN --watch "$DOC" </dev/null 2>&1 >/dev/null)
case $WATCH_SAID in
  *'--watch needs a terminal'*) ok "says --watch was not honoured without a terminal" ;;
  *) bad "says --watch was not honoured without a terminal (said: ${WATCH_SAID:-nothing})" ;;
esac
want "still prints, and still succeeds, with --watch" 0 $RUN --watch "$DOC"

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
