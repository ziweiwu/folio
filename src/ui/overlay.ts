import { ansiWidth, padAnsi, sliceAnsi, type ColorLevel } from '../core/ansi.js';

/**
 * Composite a pane over a frame.
 *
 * Cutting styled rows at arbitrary columns is exactly what `sliceAnsi` exists
 * for: the row underneath keeps whatever styling was open at the cut, so the
 * document does not lose its colours either side of the pane.
 */
export function overlayRows(
  base: readonly string[],
  pane: readonly string[],
  top: number,
  left: number,
  width: number,
  level: ColorLevel,
): string[] {
  const out = [...base];
  pane.forEach((paneRow, i) => {
    const y = top + i;
    if (y < 0 || y >= out.length) return;
    const row = out[y]!;
    /* Clipped to what is actually on screen. A pane is sized from the terminal,
       but the terminal can be narrower than the smallest drawable box, and a
       composed row that overruns the frame wraps and shears the whole display.
       The frame's width is the one thing that is never negotiable. */
    const start = Math.max(0, Math.min(left, width));
    const cut = ansiWidth(paneRow) > width - start ? sliceAnsi(paneRow, 0, width - start) : paneRow;
    const right = start + ansiWidth(cut);
    out[y] =
      sliceAnsi(row, 0, start) +
      cut +
      (right < width ? sliceAnsi(padAnsi(row, width, {}, level), right, width) : '');
  });
  return out;
}

/** Centre a pane of the given size, keeping it fully on screen. */
export function centre(
  paneWidth: number,
  paneHeight: number,
  width: number,
  height: number,
): { top: number; left: number } {
  return {
    top: Math.max(0, Math.floor((height - paneHeight) / 2)),
    left: Math.max(0, Math.floor((width - paneWidth) / 2)),
  };
}
