/**
 * Several keystrokes arriving in one read.
 *
 * Ink parses each read from the terminal as a single keypress, but a terminal
 * under fast key repeat — or over a slow link, where reads coalesce, or a
 * paste — delivers several keys in one chunk. `jjjj` then reaches the handler
 * as one input string, and a handler comparing `input === 'j'` sees nothing it
 * recognises and drops the whole burst. Which is the exact opposite of keeping
 * up with the keyboard.
 *
 * So a chunk of ordinary keys is split back into the keystrokes it stands for
 * and applied in order. This is only safe because the key handler branches on
 * refs rather than on React state: a key that changes the mode is visible to
 * the key after it in the same chunk, which is exactly what state a frame
 * behind could not do. See I-15 and I-34.
 */

export type Burst = { key: string; repeat: number };

/**
 * A key Ink can deliver inside a larger chunk.
 *
 * Printable text, plus the three whitespace keys that carry meaning. Anything
 * below them is the start of an escape sequence — an arrow, a function key —
 * which is one keypress spelled in several bytes and must never be split into
 * its bytes.
 */
function isPlainKey(ch: string): boolean {
  return ch === '\t' || ch === '\r' || ch === '\n' || (ch >= ' ' && ch !== '');
}

/** True when every key in the chunk can be taken at face value. */
export function isPlainChunk(input: string, mods: { ctrl?: boolean; meta?: boolean }): boolean {
  if (input.length <= 1 || mods.ctrl === true || mods.meta === true) return false;
  const chars = [...input];
  return chars.length === input.length && chars.every(isPlainKey);
}

export function parseBurst(input: string, mods: { ctrl?: boolean; meta?: boolean }): Burst {
  if (input.length > 1 && !mods.ctrl && !mods.meta && /^(.)\1+$/u.test(input)) {
    return { key: input[0]!, repeat: input.length };
  }
  return { key: input, repeat: 1 };
}

/**
 * The longest chunk of *different* keys still taken as typing.
 *
 * A paste is routed off this channel entirely by bracketed paste, which is the
 * real defence. This is the belt to that pair of braces: a terminal too old to
 * support it would deliver a paste as plain text, and replaying a sentence as
 * commands means the `q` in "quick" quits the viewer. Nobody types eight
 * *different* command keys inside a single terminal read; a run of one key is
 * key repeat and stays exempt however long it is.
 *
 * It is a mitigation and not a lock, and the boundary is worth stating so the
 * next reader does not assume more of it: a paste shorter than this, one that
 * is a single key repeating, or one split across several reads all still get
 * through on such a terminal. Closing those would mean rejecting fast typing,
 * which is the thing this whole module exists to keep up with.
 */
const MAX_TYPED = 8;

/**
 * A chunk split into runs of the same key.
 *
 * Runs rather than single characters, so a held key still arrives as one
 * keystroke with a repeat count: `jjjj` is four lines in one update, and `//`
 * is the `/` key repeating rather than a search for a slash.
 *
 * A chunk carrying anything that is not a plain key comes back as one segment,
 * for the caller to hand to Ink's own parse of it.
 */
export function splitBurst(input: string, mods: { ctrl?: boolean; meta?: boolean }): Burst[] {
  if (!isPlainChunk(input, mods)) return [parseBurst(input, mods)];

  const out: Burst[] = [];
  for (const c of input) {
    const last = out.at(-1);
    if (last && last.key === c) last.repeat++;
    else out.push({ key: c, repeat: 1 });
  }
  /* One key repeating is always typing. Many different ones, at length, is not.
     Counted in *runs*, which is what I-35 says ("more than eight different
     keys") and what the exemption above it means. Counting `input.length`
     instead made length stand in for variety, so two keys held in turn —
     `jjjjjkkkkk` — tripped a paste guard and all ten keystrokes were dropped on
     the floor. */
  if (out.length > MAX_TYPED) return [parseBurst(input, mods)];
  return out;
}
