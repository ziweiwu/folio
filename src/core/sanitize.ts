/**
 * Control bytes in a document are content, never instructions.
 *
 * A markdown file is untrusted input: it arrives from a repository, a
 * download, a pipe. If the bytes it contains reach the terminal unchanged,
 * then the *document* is driving the terminal — `ESC[2J` clears the reader's
 * screen, `ESC]8;;` forges a hyperlink target that is not the one displayed,
 * `\r` overwrites the line just drawn, `BEL` rings. Every one of those is the
 * file deciding what the terminal does, which is exactly the authority a
 * viewer must not hand over.
 *
 * So the source is sanitised once, on the way in, before anything parses or
 * measures it. Everything downstream — inline styling, code fences, tables,
 * front matter, OSC 8 hrefs — is then working from text that cannot escape its
 * own row, and the escape sequences in a finished row are only ever the ones
 * this viewer put there itself. See I-29.
 */

import { displayWidth } from './width.js';

/* oxlint-disable no-control-regex -- these bytes are exactly what this module is for. */

/** Every C0 control byte except newline, plus DEL. Tabs are gone by then. */
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g;

/** The same, with no exemptions at all: a line of chrome is one line. */
const CONTROL_IN_LINE = /[\x00-\x1f\x7f]/g;

/** Four, matching the indent the rest of the layout engine uses. */
const TAB_STOP = 4;

/**
 * Caret notation, the convention every pager already uses: `less` shows an
 * escape as `^[`, and a reader who sees it knows what it means. Showing the
 * byte is better than dropping it — a document that contains one is not the
 * same document as one that does not, and silently deleting content is its own
 * kind of lie.
 */
function caret(ch: string): string {
  const cp = ch.charCodeAt(0);
  return cp === 0x7f ? '^?' : `^${String.fromCharCode(cp + 64)}`;
}

/**
 * Tabs become spaces before anything measures a row.
 *
 * A tab has no width of its own: it means "advance to the next tab stop", which
 * depends on where the cursor already is. `displayWidth` therefore counts it as
 * zero, while a real terminal advances up to eight columns — so a tab that
 * survives into a row makes the layout engine's arithmetic and the screen
 * disagree, and the right-hand border of a code block lands in the wrong place.
 *
 * Expanding against real tab stops rather than substituting a fixed number of
 * spaces is what keeps columns of code lined up, and it is what CommonMark says
 * a tab means in the first place — so parsing sees an equivalent document.
 */
function expandTabs(src: string): string {
  if (!src.includes('\t')) return src;
  return src
    .split('\n')
    .map((line) => {
      if (!line.includes('\t')) return line;
      /* Measured a whole run at a time, never character by character. Width is
         not a property of a single character: `U+FE0F` widens the glyph
         *before* it, so `displayWidth` has to carry state across the string,
         and calling it per character throws exactly that away — which made a
         line of `⚠️` before a tab come out one stop short. See I-2. */
      const parts = line.split('\t');
      let out = parts[0]!;
      let col = displayWidth(parts[0]!);
      for (let i = 1; i < parts.length; i++) {
        const pad = TAB_STOP - (col % TAB_STOP);
        out += ' '.repeat(pad) + parts[i]!;
        col += pad + displayWidth(parts[i]!);
      }
      return out;
    })
    .join('\n');
}

/**
 * `\n` survives, because it is the line structure the author wrote. `\t`
 * survives as the spaces it stands for. `\r\n` is normalised first so a CRLF
 * file does not end every line with a visible `^M`; a *lone* `\r` is a real
 * control byte and is shown as one.
 */
export function sanitizeSource(src: string): string {
  return expandTabs(src.replace(/\r\n/g, '\n')).replace(CONTROL, caret);
}

/**
 * The same rule for a single line of chrome — a filename, a status message.
 *
 * A file can be *named* with an escape sequence, and the status bar prints the
 * name it was given.
 */
export function sanitizeLine(text: string): string {
  return text.replace(CONTROL_IN_LINE, caret);
}
