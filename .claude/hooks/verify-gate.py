#!/usr/bin/env python3
"""Stop hook: refuse to end a turn that left the gate list unrun.

AGENTS.md lists the checks that must pass before anything is called working.
That list is a request, and a request is not a gate -- a turn can end with a
type error in the tree and a confident summary above it. This runs the list.

Design notes, each one a failure mode this had to avoid:

  - It is keyed on a fingerprint of the working tree, so a second stop that
    changed nothing does not pay for the suite twice.
  - It blocks at most once per fingerprint. Blocking every time would trap a
    session that genuinely cannot fix the failure: Claude would be told to
    continue, stop again, and be told again, forever. One block per distinct
    tree state means the failure is always surfaced and the user always gets
    control back.
  - A clean tree relative to HEAD skips everything. Reading and answering
    questions is not a change worth a build for.
  - verify:pty is deliberately absent. It is minutes long and needs a real pty;
    CI carries it. See .github/workflows/ci.yml.
"""

import hashlib
import json
import os
import subprocess
import sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATE = os.path.join(REPO, ".claude", ".verify-gate-state.json")
# Pathspecs, not prefixes: git matches whole path components, so a bare
# "tsconfig" matches a file or directory of exactly that name and nothing else.
# Spelling the manifests out is what keeps a tsconfig or lockfile change --
# the change most likely to break the build -- from skipping the whole gate.
WATCHED = (
    "src/", "test/", "scripts/",
    "package.json", "package-lock.json",
    "tsconfig.json", "tsconfig.build.json",
)

GATES = [
    ("typecheck", ["npm", "run", "typecheck"]),
    ("lint", ["npm", "run", "lint"]),
    ("test", ["npm", "test"]),
    ("build", ["npm", "run", "build"]),
    ("verify:smoke", ["npm", "run", "verify:smoke"]),
    ("verify:screenshots", ["npm", "run", "verify:screenshots"]),
]

# Per gate. Six gates, so the worst case is 6 x TIMEOUT -- keep the hook's own
# timeout in .claude/settings.json at or above that, or the harness kills the
# run before save_state, nothing is recorded, and the gate quietly stops gating.
TIMEOUT = 600

UNREADABLE = "tree-unreadable"


class GitFailed(Exception):
    """git ran and refused to answer -- an index.lock, a rebase, no commits."""


def git(*args):
    done = subprocess.run(
        ["git", "-C", REPO, *args],
        capture_output=True, text=True, timeout=30,
    )
    if done.returncode != 0:
        # Without this the empty stdout reads as "nothing changed" and the gate
        # skips itself silently. subprocess.run does not raise on its own here.
        raise GitFailed(f"git {' '.join(args)}: {done.stderr.strip()}")
    return done.stdout


def fingerprint():
    """Hash of every watched change in the tree, staged or not.

    Returns None when nothing watched has changed, which is the skip signal.
    """
    status = git("status", "--porcelain", "--", *WATCHED)
    if not status.strip():
        return None
    diff = git("diff", "HEAD", "--", *WATCHED)
    untracked = git("ls-files", "--others", "--exclude-standard", "--", *WATCHED)
    blob = status + diff + untracked
    for path in untracked.split("\n"):
        path = path.strip()
        if not path:
            continue
        try:
            with open(os.path.join(REPO, path), "rb") as handle:
                blob += handle.read().decode("utf-8", "replace")
        except OSError:
            pass
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:16]


def load_state():
    try:
        with open(STATE, encoding="utf-8") as handle:
            return json.load(handle)
    except (OSError, ValueError):
        return {}


def save_state(state):
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(state, handle)
    os.replace(tmp, STATE)


def run_gates():
    """First failure wins. Returns (name, output) or None if all passed.

    The gates run in the ambient environment on purpose. An earlier version set
    NO_COLOR=1 and FORCE_COLOR=0 here to keep the captured output clean, and it
    broke verify:smoke: one of its checks runs `FORCE_COLOR=3` and asserts that
    colour *survives*, because that is what `less -R` needs. An inherited
    NO_COLOR won that argument and the check failed for a reason that had
    nothing to do with the app. Nothing needs forcing anyway -- output is
    captured, so no gate is talking to a terminal to begin with.
    """
    for name, cmd in GATES:
        try:
            done = subprocess.run(
                cmd, cwd=REPO, capture_output=True, text=True,
                timeout=TIMEOUT,
            )
        except subprocess.TimeoutExpired:
            return name, f"timed out after {TIMEOUT}s"
        if done.returncode != 0:
            tail = (done.stdout + done.stderr).strip().split("\n")
            return name, "\n".join(tail[-40:])
    return None


def main():
    try:
        json.loads(sys.stdin.read() or "{}")
    except ValueError:
        pass

    try:
        current = fingerprint()
    except GitFailed:
        # A tree we cannot read is not a tree we can call clean, so run the
        # gates rather than skip them. The sentinel keeps the block-once rule
        # working; it is never recorded as passed, because it describes no
        # particular tree.
        current = UNREADABLE
    except (subprocess.SubprocessError, OSError):
        return 0  # no usable git at all; never stand in the way

    if current is None:
        return 0

    state = load_state()
    if state.get("passed") == current:
        return 0
    if state.get("blocked") == current:
        # Already told Claude about this exact tree once. Let the turn end so
        # the user sees the failure and decides, rather than looping.
        return 0

    failure = run_gates()
    if failure is None:
        if current != UNREADABLE:
            save_state({"passed": current})
        return 0

    name, output = failure
    save_state({"blocked": current})
    print(json.dumps({
        "decision": "block",
        "reason": (
            f"The gate list in AGENTS.md is not passing: `npm run {name}` failed.\n\n"
            f"{output}\n\n"
            "Fix this before ending the turn. If you believe the failure is "
            "unrelated to your change, say so explicitly rather than implying "
            "the checks passed."
        ),
    }))
    return 0


if __name__ == "__main__":
    sys.exit(main())
