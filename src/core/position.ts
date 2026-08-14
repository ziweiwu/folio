import type { Line } from './types.js';

/**
 * Scroll position arithmetic, kept out of the hook so it can be tested
 * directly rather than through React.
 */

/** The last offset that still fills the viewport. Never negative. */
export function maxOffset(total: number, height: number): number {
  return Math.max(0, total - height);
}

/** See I-5: an offset is always in range, including for an empty document. */
export function clampOffset(offset: number, total: number, height: number): number {
  return Math.max(0, Math.min(offset, maxOffset(total, height)));
}

/**
 * Where the viewport should sit after a re-layout.
 *
 * A resize changes how many rows the document occupies, so the old offset
 * points at different text. The block that was at the top of the viewport is
 * remembered instead and looked up again in the new rows, which keeps the
 * reader's place across a resize rather than throwing them back to the top.
 * See I-6.
 */
export function anchorOffset(lines: readonly Line[], block: number, height: number): number {
  const found = lines.findIndex((l) => l.block >= block);
  return clampOffset(found === -1 ? lines.length : found, lines.length, height);
}
