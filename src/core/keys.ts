/**
 * Key repeat arriving in bursts.
 *
 * Ink parses each read from the terminal as a single keypress, but a terminal
 * under fast key repeat — or over a slow link, where reads coalesce — delivers
 * several repeats in one chunk. `jjjj` then reaches the handler as one input
 * string, and a handler comparing `input === 'j'` sees nothing it recognises
 * and drops the whole burst. Which is the exact opposite of keeping up with
 * the keyboard.
 *
 * Only a run of one repeated character is treated as a burst. Mixed input like
 * `tq` would have to change mode between characters, and mode is React state
 * that will not have updated yet — so it is left as a single keypress rather
 * than dispatched wrongly.
 */

export type Burst = { key: string; repeat: number };

export function parseBurst(input: string, mods: { ctrl?: boolean; meta?: boolean }): Burst {
  if (input.length > 1 && !mods.ctrl && !mods.meta && /^(.)\1+$/u.test(input)) {
    return { key: input[0]!, repeat: input.length };
  }
  return { key: input, repeat: 1 };
}
