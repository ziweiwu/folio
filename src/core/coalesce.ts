/**
 * Leading-edge throttle for scroll deltas.
 *
 * A terminal repeats a held key roughly every 30ms and an Ink frame costs
 * roughly 30ms to draw, so rendering once per keystroke falls behind the
 * keyboard immediately and never recovers. Applying the first event straight
 * away keeps a single keypress instant; accumulating everything that arrives
 * during the following frame into one further update keeps a held key smooth.
 *
 * Kept out of the hook so the timing can be tested against a fake clock rather
 * than against React. See I-9.
 */

export type Coalescer = {
  push: (delta: number) => void;
  /** Apply anything pending right now, e.g. before an absolute jump. */
  discard: () => void;
  cancel: () => void;
};

export type CoalescerDeps = {
  frameMs: number;
  flush: (delta: number) => void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
};

export function createCoalescer({
  frameMs,
  flush,
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
}: CoalescerDeps): Coalescer {
  let pending = 0;
  let timer: unknown = null;

  const emit = () => {
    const delta = pending;
    pending = 0;
    if (delta !== 0) flush(delta);
  };

  return {
    push(delta) {
      pending += delta;
      if (timer !== null) return;
      emit();
      timer = setTimer(() => {
        timer = null;
        emit();
      }, frameMs);
    },
    discard() {
      pending = 0;
    },
    cancel() {
      if (timer !== null) clearTimer(timer);
      timer = null;
      pending = 0;
    },
  };
}
