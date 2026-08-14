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
    const paneWidth = ansiWidth(paneRow);
    const right = left + paneWidth;
    out[y] =
      sliceAnsi(row, 0, left) +
      paneRow +
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
