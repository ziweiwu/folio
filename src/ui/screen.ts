/**
 * Alt screen, cursor and mouse reporting.
 *
 * Getting out is more important than getting in. A viewer that exits without
 * turning mouse reporting off leaves the user's shell printing escape garbage
 * on every click, and one that exits without leaving the alternate buffer eats
 * their scrollback. So restoration is wired to every exit path there is —
 * normal return, Ctrl-C, an external signal, and an unhandled throw. See I-7.
 */

const ENTER_ALT = '\x1b[?1049h';
const LEAVE_ALT = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
/** 1000 reports button presses (which includes the wheel); 1006 asks for the
 *  SGR encoding, which is the only one that survives past column 223. */
const MOUSE_ON = '\x1b[?1000h\x1b[?1006h';
const MOUSE_OFF = '\x1b[?1006l\x1b[?1000l';

type Screen = { out: NodeJS.WriteStream; mouse: boolean };

let current: Screen | null = null;
let installed = false;

export function enterScreen(out: NodeJS.WriteStream, mouse: boolean): void {
  if (current) return;
  current = { out, mouse };
  out.write(ENTER_ALT + HIDE_CURSOR + (mouse ? MOUSE_ON : ''));
  install();
}

/** Idempotent: safe to call from several exit paths at once. */
export function leaveScreen(): void {
  const screen = current;
  if (!screen) return;
  current = null;
  screen.out.write((screen.mouse ? MOUSE_OFF : '') + SHOW_CURSOR + LEAVE_ALT);
}

export function isScreenActive(): boolean {
  return current !== null;
}

function install(): void {
  if (installed) return;
  installed = true;

  process.on('exit', leaveScreen);

  // 128 + signal number is the shell's convention for "killed by this signal".
  const onSignal = (signal: NodeJS.Signals, status: number) => () => {
    leaveScreen();
    process.removeAllListeners(signal);
    process.exit(status);
  };
  process.on('SIGINT', onSignal('SIGINT', 130));
  process.on('SIGTERM', onSignal('SIGTERM', 143));
  process.on('SIGHUP', onSignal('SIGHUP', 129));

  process.on('uncaughtException', (err) => {
    // Restore first: the stack trace is unreadable inside the alternate buffer,
    // and it would vanish with it a moment later.
    leaveScreen();
    console.error(err);
    process.exit(1);
  });
}
