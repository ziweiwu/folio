/**
 * Copying to the clipboard from inside a terminal, over OSC 52.
 *
 * The point of OSC 52 is that it works through SSH and inside tmux, where a
 * local `pbcopy` cannot reach the clipboard the user is actually looking at.
 * The cost is that it is advisory: the terminal may refuse, and says nothing
 * either way, so the caller must not claim more than "sent".
 */

/** Terminals commonly refuse very large payloads; a code block is never this big. */
export const MAX_BYTES = 100_000;

export type CopyResult = { ok: true; sequence: string; bytes: number } | { ok: false; reason: string };

export function osc52(text: string): CopyResult {
  if (text === '') return { ok: false, reason: 'nothing to copy' };
  const encoded = Buffer.from(text, 'utf8').toString('base64');
  if (encoded.length > MAX_BYTES) {
    return { ok: false, reason: 'too large for the terminal clipboard' };
  }
  // `c` is the system clipboard, as opposed to a selection buffer.
  return { ok: true, sequence: `\x1b]52;c;${encoded}\x07`, bytes: Buffer.byteLength(text, 'utf8') };
}
