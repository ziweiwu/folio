import { useEffect } from 'react';

/** Lines a single wheel notch moves. Three matches every other pager. */
export const WHEEL_LINES = 3;

const SGR_MOUSE = /\x1b\[<(?<button>\d+);(?<column>\d+);(?<row>\d+)(?<press>[Mm])/g;

const WHEEL_UP = 64;
const WHEEL_DOWN = 65;

/**
 * The button bits, with the modifier bits masked off.
 *
 * A report's button field carries shift (4), meta (8) and control (16)
 * alongside the button number in its low two bits. A shift-click is still a
 * left click, so the modifiers are dropped rather than compared: the viewer has
 * nothing that a modified click should mean differently, and treating one as
 * unrecognised would make a click silently do nothing depending on which keys
 * the reader happened to be resting a finger on.
 *
 * Motion (32) is *not* a modifier and is not masked away with them: it changes
 * what the event is rather than who was holding what, and a drag whose motion
 * bit had been dropped would read as a fresh click on every cell it crossed.
 * The viewer only ever asks for mode 1000, which never reports motion, so this
 * is a guard against a mode it does not request yet rather than a live bug.
 */
const BUTTON = 0b11;
const LEFT = 0;

/** Set on a report that describes the pointer moving, not a button changing. */
const MOTION = 32;

/** How far one report moves the viewport, and zero for anything that is not a wheel. */
function wheelDelta(button: number): number {
  if (button === WHEEL_UP) return -WHEEL_LINES;
  if (button === WHEEL_DOWN) return WHEEL_LINES;
  return 0;
}

function isLeftPress(button: number, terminator: string): boolean {
  return terminator === 'M' && button < MOTION && (button & BUTTON) === LEFT;
}

/** Where on the screen something happened, indexed from zero. */
export type Cell = { column: number; row: number };

/**
 * Everything one terminal read has to say about the mouse.
 *
 * A read can hold several reports — a wheel spun quickly batches them — so the
 * notches are summed into one movement while every click is kept, rather than
 * scrolling once per notch and redrawing for each.
 */
function readReports(text: string): { delta: number; clicks: Cell[] } {
  const clicks: Cell[] = [];
  let delta = 0;
  SGR_MOUSE.lastIndex = 0;
  for (const report of text.matchAll(SGR_MOUSE)) {
    const { button, column, row, press } = report.groups!;
    const code = Number(button);
    delta += wheelDelta(code);
    // The terminal counts from one; every coordinate in this app is an index
    // from zero.
    if (isLeftPress(code, press!)) clicks.push({ column: Number(column) - 1, row: Number(row) - 1 });
  }
  return { delta, clicks };
}

function mouseListener(onWheel: (deltaLines: number) => void, onClick?: (column: number, row: number) => void) {
  return (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    if (!text.includes('\x1b[<')) return;
    const { delta, clicks } = readReports(text);
    if (delta !== 0) onWheel(delta);
    for (const at of clicks) onClick?.(at.column, at.row);
  };
}

/**
 * Wheel and click events from SGR mouse reporting.
 *
 * Ink has no mouse support, so this reads the raw stream alongside it. The
 * sequences also reach Ink's own key parser, which is why `useInput` has to
 * ignore anything `isMouseSequence` recognises — otherwise a scroll would
 * register as a burst of keystrokes.
 *
 * Only the press is acted on. Mode 1000 reports the release too, as the same
 * button number with a lowercase terminator, and following a link on both
 * would follow it twice.
 */
export function useMouse(
  stdin: NodeJS.ReadStream | undefined,
  enabled: boolean,
  onWheel: (deltaLines: number) => void,
  onClick?: (column: number, row: number) => void,
): void {
  useEffect(() => {
    if (!enabled || !stdin) return;
    const onData = mouseListener(onWheel, onClick);
    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin, enabled, onWheel, onClick]);
}

/**
 * True for input that is really a mouse report, which key handling must skip.
 *
 * Matched on the *whole* report — `[<button;column;row` and its terminating
 * `M` or `m` — rather than on the `[<` introducer alone. Ink strips a leading
 * ESC from anything it could not parse, so the escape-prefixed form is not
 * enough on its own and the bare introducer has to be recognised too; but a
 * bare `[<` also occurs in ordinary text, and `useInput` drops the entire
 * chunk this returns true for. Typing `[<` fast enough to land in one read —
 * which is exactly the burst coalescing I-15 exists to handle — therefore
 * swallowed those two keys *and every other key in the chunk with them*,
 * silently, with no status message: `/` then `[<T` searched for `T`.
 *
 * Requiring the digits and the terminator costs nothing here and cannot match
 * text anybody types. It assumes a report arrives whole, which is the same
 * assumption `SGR_MOUSE` above already makes when it parses one.
 */
const SGR_REPORT = /\[<\d+;\d+;\d+[Mm]/;

export function isMouseSequence(input: string): boolean {
  return SGR_REPORT.test(input);
}
