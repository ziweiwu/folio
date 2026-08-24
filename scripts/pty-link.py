#!/usr/bin/env python3
"""The I-31 check: following a link the filesystem refuses to open.

`stat` succeeding does not mean a file can be read, so `open` may reject after
the viewer has already committed to the navigation. A rejection React cannot
render takes the whole viewer down with a blank screen, so the failure has to
become a status message like any other.

Driven through a pty opened here rather than through script(1), which is what
the rest of this suite uses. On the macOS CI runner script's typescript cannot
be read while the run is in progress -- the alternate-screen sequence showed up
instantly and the document's own heading was still missing 84 seconds later, in
a file that ended up holding the whole session -- so a check that has to *react*
to what is on screen cannot be built on it. Reading the pty master directly has
no such problem, and it is the only check here whose keystrokes must be aimed
at a particular frame rather than merely sent.
"""

from __future__ import annotations

import os
import pty
import re
import select
import shutil
import stat
import sys
import tempfile
import time

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VIEWER = os.path.join(REPO, "dist", "cli.js")

# Long enough for a cold start on a loaded shared runner; the reads below return
# as soon as their marker lands, so this only bounds the pathological case.
READY_TIMEOUT = 90.0
REPLY_TIMEOUT = 30.0

# How long to block waiting for the pty to have something to say. Short enough
# that a caller asking for a tenth of a second gets roughly that.
POLL_SECONDS = 0.05
# One read. Larger than any frame this viewer draws, so a frame arrives whole.
READ_BYTES = 65536
# A pause between waking to re-check, when nothing has arrived yet.
RECHECK_SECONDS = 0.1
# Long enough for the link cursor to land before Enter follows it.
KEY_GAP_SECONDS = 0.5
# How much of the screen to show when the check fails: enough to see the status
# bar and the rows above it, not so much that the real line scrolls away.
DIAGNOSTIC_CHARS = 300
SIGKILL = 9

ANSI = re.compile(rb"\x1b\[[0-9;?]*[a-zA-Z]|\x1b\][^\x07]*\x07")


def report(ok: bool, label: str) -> bool:
    print(f"  {'ok  ' if ok else 'FAIL'}  {label}")
    return ok


class Viewer:
    """A running viewer, and everything it has drawn so far."""

    def __init__(self, path: str, state: str) -> None:
        self.buf = b""
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            os.environ["XDG_STATE_HOME"] = state
            os.environ["FORCE_COLOR"] = "3"
            os.execvp("node", ["node", VIEWER, "--no-resume", path])

    def pump(self, seconds: float) -> None:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            ready, _, _ = select.select([self.fd], [], [], POLL_SECONDS)
            if not ready:
                continue
            try:
                chunk = os.read(self.fd, READ_BYTES)
            except OSError:
                return
            if not chunk:
                return
            self.buf += chunk

    def wait_for(self, marker: bytes, timeout: float) -> bool:
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            if marker in self.text():
                return True
            self.pump(RECHECK_SECONDS)
        return marker in self.text()

    def send(self, keys: bytes) -> None:
        os.write(self.fd, keys)

    def text(self) -> bytes:
        return ANSI.sub(b"", self.buf)

    def close(self) -> None:
        try:
            os.kill(self.pid, SIGKILL)
        except ProcessLookupError:
            pass
        os.close(self.fd)


def write_fixture(work: str) -> tuple[str, str]:
    """A document linking to a file the filesystem will refuse to open."""
    main_md = os.path.join(work, "main.md")
    secret = os.path.join(work, "secret.md")
    with open(main_md, "w") as f:
        f.write("# Main\n\nGo to [secret](./secret.md) now.\n")
    with open(secret, "w") as f:
        f.write("# Secret\n")
    os.chmod(secret, 0)
    return main_md, secret


def is_unreadable(path: str) -> bool:
    """Whether `chmod 000` actually denied this user. Root it does not."""
    try:
        with open(path, "rb"):
            return False
    except PermissionError:
        return True


def show_screen(viewer: Viewer) -> None:
    """The rows the viewer last drew, for a failure that has to explain itself."""
    rows = viewer.text().replace(b"\r", b"\n").split(b"\n")
    tail = b" | ".join(row.strip() for row in rows if row.strip())[-DIAGNOSTIC_CHARS:]
    print(f"        last saw: {tail.decode('utf8', 'replace')}")


def follow_the_link(viewer: Viewer) -> bool:
    """Pick the link, follow it, and check what the viewer made of the refusal."""
    if not viewer.wait_for(b"Main", READY_TIMEOUT):
        return report(False, "the viewer never drew the document, so nothing was tested")

    viewer.send(b"\t")   # pick the link
    viewer.pump(KEY_GAP_SECONDS)
    viewer.send(b"\r")   # follow it

    ok = report(viewer.wait_for(b"permission denied", REPLY_TIMEOUT),
                "reports an unreadable link target")
    if not ok:
        show_screen(viewer)

    # A crash prints "permission denied" in its stack trace too, and the screen
    # is restored either way. What separates a reported failure from a fatal one
    # is whether anything is still there to draw the next frame.
    ok &= report(b"at readFileSync" not in viewer.text(),
                 "no stack trace escaped to the terminal")
    viewer.send(b"?")
    ok &= report(viewer.wait_for(b"reload from disk", REPLY_TIMEOUT),
                 "still drawing frames afterwards")
    viewer.send(b"q")
    viewer.pump(1.0)
    return ok


def main() -> int:
    print("a link it cannot read (I-31)")
    work = tempfile.mkdtemp(prefix="umv-link.")
    state = tempfile.mkdtemp(prefix="umv-link-state.")
    secret = ""
    try:
        main_md, secret = write_fixture(work)
        # Asserted rather than assumed, so an environment that cannot produce
        # the condition says so instead of being reported as the viewer failing
        # to notice it.
        if not is_unreadable(secret):
            print("  SKIP  reports an unreadable link target — this user can read mode 000")
            return 0

        viewer = Viewer(main_md, state)
        try:
            return 0 if follow_the_link(viewer) else 1
        finally:
            viewer.close()
    finally:
        if secret:
            os.chmod(secret, stat.S_IRUSR | stat.S_IWUSR)
        shutil.rmtree(work, ignore_errors=True)
        shutil.rmtree(state, ignore_errors=True)


if __name__ == "__main__":
    sys.exit(main())
