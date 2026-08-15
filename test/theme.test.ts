import { describe, expect, it } from 'vitest';
import { THEMES } from '../src/ui/theme.js';
import type { Style } from '../src/core/ansi.js';
import type { Theme } from '../src/core/types.js';

/**
 * I-27. Contrast is measured, not eyeballed.
 *
 * A terminal row carries no background of its own unless the style says so, so
 * each token is checked against the ground it is actually drawn on: the
 * terminal's own background for body text, the code background inside a fence,
 * the status bar's own fill, the overlay's own fill.
 */

/** The terminal background each theme is designed for. */
const GROUND: Record<string, string> = { dark: '#1a1b26', light: '#ffffff' };

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
  const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
}

export function contrast(fg: string, bg: string): number {
  const [a, b] = [luminance(fg), luminance(bg)];
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** Tokens that carry words a reader has to read. WCAG 1.4.3 puts these at 4.5. */
const TEXT: ReadonlyArray<keyof Theme> = [
  'text', 'muted', 'faint', 'h2', 'h3', 'h4', 'strong', 'em', 'strike',
  'link', 'linkUrl', 'codeText', 'codeLabel', 'inlineCode', 'quoteText', 'tableHeader',
  'image', 'frontMatterKey', 'frontMatterValue', 'status', 'statusAccent',
  'statusMuted', 'overlayText', 'overlayTitle', 'codeGutter',
];

/** Structural marks — rules, borders, glyphs. WCAG 1.4.11 puts these at 3. */
const STRUCTURAL: ReadonlyArray<keyof Theme> = [
  'headingRule', 'rule', 'tableBorder', 'quoteBar', 'listMarker',
  'taskDone', 'taskTodo', 'scrollThumb',
];

/** The background a token is drawn over, when it is not the terminal's own. */
function groundFor(theme: Theme, token: keyof Theme): string {
  const style = theme[token] as Style;
  if (style.bg) return style.bg;
  if (token === 'codeGutter' || token === 'codeLabel' || token === 'codeText') return theme.codeBg;
  return GROUND[theme.name]!;
}

/**
 * Deliberately exempt, and listed here so the exemption is a decision on the
 * record rather than a token nobody checked.
 *
 * The scrollbar track is the rail the thumb slides along. The thumb is what
 * carries the position, and the status bar prints the same thing as a
 * percentage, so the track is decoration in the WCAG 1.4.11 sense. It is still
 * asserted to *exist* as a distinguishable tone, so it cannot silently become
 * the background colour.
 */
const DECORATIVE: ReadonlyArray<keyof Theme> = ['scrollTrack'];

describe('I-27 theme colour meets WCAG AA against the ground it is drawn on', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    for (const token of TEXT) {
      it(`I-27 ${name} ${String(token)} is legible as text`, () => {
        const style = theme[token] as Style;
        const ratio = contrast(style.fg!, groundFor(theme, token));
        expect(
          ratio,
          `${name}.${String(token)} ${style.fg} on ${groundFor(theme, token)} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }

    for (const token of STRUCTURAL) {
      it(`I-27 ${name} ${String(token)} is perceptible as a mark`, () => {
        const style = theme[token] as Style;
        const ratio = contrast(style.fg!, groundFor(theme, token));
        expect(
          ratio,
          `${name}.${String(token)} ${style.fg} on ${groundFor(theme, token)} = ${ratio.toFixed(2)}:1`,
        ).toBeGreaterThanOrEqual(3);
      });
    }

    for (const token of DECORATIVE) {
      it(`I-27 ${name} ${String(token)} is exempt, but still a tone of its own`, () => {
        const style = theme[token] as Style;
        const ratio = contrast(style.fg!, groundFor(theme, token));
        expect(ratio, `${name}.${String(token)} has vanished into the background`).toBeGreaterThan(1.1);
        // If this ever clears 3:1 it is no longer decoration and belongs above.
        expect(ratio).toBeLessThan(3);
      });
    }

    it(`I-27 ${name} covers every colour token`, () => {
      /* The point of the lists is that nothing sits outside them. A token added
         to the theme without a decision about its contrast fails here. */
      const classified = new Set([...TEXT, ...STRUCTURAL, ...DECORATIVE, 'h1', 'match', 'matchCurrent']);
      const unclassified = Object.entries(theme)
        .filter(([, value]) => typeof value === 'object' && value !== null && 'fg' in value)
        .map(([key]) => key)
        .filter((key) => !classified.has(key as keyof Theme));
      expect(unclassified, 'these theme tokens have no contrast decision').toEqual([]);
    });

    it(`I-27 ${name} highlights a match legibly`, () => {
      for (const token of ['match', 'matchCurrent'] as const) {
        const style = theme[token];
        expect(contrast(style.fg!, style.bg!), `${name}.${token}`).toBeGreaterThanOrEqual(4.5);
      }
    });

    it(`I-27 ${name} keeps the H1 band legible`, () => {
      expect(contrast(theme.h1.fg!, theme.h1.bg!)).toBeGreaterThanOrEqual(4.5);
    });

    it(`I-27 ${name} keeps text, muted and faint distinguishable from each other`, () => {
      // A three-step hierarchy is only a hierarchy if the steps differ.
      const ground = GROUND[name]!;
      const steps = [theme.text, theme.muted, theme.faint].map((s) => contrast(s.fg!, ground));
      expect(steps[0]).toBeGreaterThan(steps[1]!);
      expect(steps[1]).toBeGreaterThan(steps[2]!);
    });
  }
});
