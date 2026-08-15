import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createCoalescer } from '../core/coalesce.js';
import { clampOffset, maxOffset } from '../core/position.js';

/** One frame at 60 Hz. Coalescing to this is what keeps held keys fluid. */
export const FRAME_MS = 16;

export type Scroll = {
  offset: number;
  /**
   * The same value, current the instant a key changes it.
   *
   * `offset` is state and is therefore a frame behind for the rest of a chunk
   * of keys. A handler that *branches* on where the viewport is — seeding the
   * link cursor, the next match, the contents selection, the code block to copy
   * — has to read this instead, or `Gt` picks the heading `G` was standing on
   * rather than the one it jumped to. See I-34.
   */
  offsetRef: { readonly current: number };
  scrollBy: (delta: number) => void;
  scrollTo: (offset: number) => void;
  atTop: boolean;
  atBottom: boolean;
};

/**
 * Scroll position, throttled to one render per frame.
 *
 * Terminals repeat a held key every ~30ms, and an Ink frame costs ~30ms to
 * draw. Rendering per keystroke therefore falls behind the keyboard almost
 * immediately and never catches up, which is exactly what makes other terminal
 * pagers feel sluggish on a long document.
 *
 * The fix is leading-edge throttling: the first event applies immediately, so a
 * single keypress is instant, and everything arriving in the next frame is
 * accumulated into one further update. Holding `j` then produces smooth fast
 * scrolling — a few lines per frame — instead of a growing queue. See I-9.
 */
export function useScroll(total: number, height: number, initial = 0): Scroll {
  /* Seeded rather than scrolled-to after mount: resuming with an effect paints
     the top of the document for one frame and then jumps, which reads as a
     glitch. The initialiser runs once, so later changes to `initial` are
     correctly ignored. */
  const [offset, setOffset] = useState(() => clampOffset(initial, total, height));
  const offsetRef = useRef(clampOffset(initial, total, height));
  const limitRef = useRef({ total, height });
  limitRef.current = { total, height };

  const clamp = useCallback((n: number) => {
    const { total: t, height: h } = limitRef.current;
    return clampOffset(n, t, h);
  }, []);

  const apply = useCallback(
    (next: number) => {
      const clamped = clamp(next);
      if (clamped === offsetRef.current) return;
      offsetRef.current = clamped;
      setOffset(clamped);
    },
    [clamp],
  );

  const coalescer = useMemo(
    () =>
      createCoalescer({
        frameMs: FRAME_MS,
        flush: (delta) => apply(offsetRef.current + delta),
      }),
    [apply],
  );

  const scrollBy = useCallback((delta: number) => coalescer.push(delta), [coalescer]);

  const scrollTo = useCallback(
    (next: number) => {
      // An absolute jump supersedes anything still queued; without this, a
      // pending `j` would slide the view off the heading you just picked.
      coalescer.discard();
      apply(next);
    },
    [coalescer, apply],
  );

  // A resize or a reload can leave the offset past the end of a shorter
  // document; re-clamp rather than render a screen of blanks.
  useEffect(() => {
    apply(offsetRef.current);
  }, [total, height, apply]);

  useEffect(() => () => coalescer.cancel(), [coalescer]);

  return {
    offset,
    offsetRef,
    scrollBy,
    scrollTo,
    atTop: offset === 0,
    atBottom: offset >= maxOffset(total, height),
  };
}
