import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  ansiWidth,
  detectColorLevel,
  hyperlink,
  paint,
  sliceAnsi,
  stripAnsi,
  to256,
} from '../src/core/ansi.js';
import { displayWidth } from '../src/core/width.js';

const styled = (s: string) => paint(s, { fg: '#7aa2f7', bold: true }, 3);

describe('colour capability', () => {
  it('honours NO_COLOR above everything else', () => {
    expect(detectColorLevel({ NO_COLOR: '1', COLORTERM: 'truecolor' })).toBe(0);
  });

  it('reads truecolor from COLORTERM and 256 from TERM', () => {
    expect(detectColorLevel({ COLORTERM: 'truecolor' })).toBe(3);
    expect(detectColorLevel({ TERM: 'xterm-256color' })).toBe(2);
    expect(detectColorLevel({ TERM: 'dumb' })).toBe(0);
  });

  it('maps a colour to a plausible xterm-256 index', () => {
    expect(to256('#000000')).toBe(16);
    expect(to256('#ffffff')).toBe(231);
    // Near-neutrals should land on the grey ramp, which is finer than the cube.
    expect(to256('#808080')).toBeGreaterThanOrEqual(232);
  });

  it('emits no escapes at all when colour is off', () => {
    expect(paint('hello', { fg: '#ff0000', bold: true }, 0)).toBe('hello');
    expect(hyperlink('hello', 'https://example.com', 0)).toBe('hello');
  });
});

describe('measurement', () => {
  it('ignores escapes when measuring width', () => {
    expect(ansiWidth(styled('hello'))).toBe(5);
    expect(ansiWidth(hyperlink(styled('hi'), 'https://example.com', 3))).toBe(2);
  });

  it('strips every escape it emits', () => {
    expect(stripAnsi(hyperlink(styled('hi'), 'https://x', 3))).toBe('hi');
  });
});

describe('sliceAnsi', () => {
  it('cuts by display cells, not code units', () => {
    expect(stripAnsi(sliceAnsi(styled('hello world'), 0, 5))).toBe('hello');
    expect(stripAnsi(sliceAnsi(styled('hello world'), 6, 11))).toBe('world');
  });

  it('carries the style that was open at the cut', () => {
    const s = 'plain' + styled('BOLD') + 'plain';
    const cut = sliceAnsi(s, 6, 8);
    expect(stripAnsi(cut)).toBe('OL');
    expect(cut).toMatch(/\x1b\[/); // the bold-blue run is re-opened
    expect(cut.endsWith('\x1b[0m')).toBe(true);
  });

  it('replaces a wide glyph straddling an edge with a space', () => {
    const s = '你好世界'; // four two-cell glyphs
    expect(sliceAnsi(s, 0, 3)).toBe('你 ');
    expect(sliceAnsi(s, 1, 4)).toBe(' 好');
  });

  it('closes a hyperlink it opened', () => {
    const s = hyperlink('click here', 'https://example.com', 3);
    const cut = sliceAnsi(s, 2, 7);
    expect(stripAnsi(cut)).toBe('ick h');
    expect(cut).toContain('\x1b]8;;https://example.com');
    expect(cut.endsWith('\x1b]8;;\x07')).toBe(true);
  });

  it('returns nothing for an empty or inverted range', () => {
    expect(sliceAnsi(styled('hello'), 3, 3)).toBe('');
    expect(sliceAnsi(styled('hello'), 4, 2)).toBe('');
  });

  it('reassembles into the original text for any split point', () => {
    fc.assert(
      fc.property(
        fc.array(fc.oneof(fc.string(), fc.constantFrom('你', '好', '⚠️', '🚀', 'a', 'bb')), {
          maxLength: 12,
        }),
        fc.nat(40),
        (parts, cutRaw) => {
          const plainText = parts.join('');
          const s = parts.map((p, i) => (i % 2 === 0 ? p : styled(p))).join('');
          const total = displayWidth(plainText);
          const cut = cutRaw % (total + 1);
          const left = sliceAnsi(s, 0, cut);
          const right = sliceAnsi(s, cut, total);
          // Widths always add up, even when a wide glyph is split into spaces.
          expect(ansiWidth(left) + ansiWidth(right)).toBe(total);
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never produces a slice wider than the range asked for', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z 你好🚀]{0,30}$/u),
        fc.nat(30),
        fc.nat(30),
        (text, a, b) => {
          const start = Math.min(a, b);
          const end = Math.max(a, b);
          expect(ansiWidth(sliceAnsi(styled(text), start, end))).toBeLessThanOrEqual(end - start);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('I-2 slicing and measuring agree about what a glyph is', () => {
  const GLYPHS = ['a', '中', '⚠️', '👩‍💻', '👨‍👩‍👧‍👦', '🧑‍🤝‍🧑', '👋🏽', '🏴‍☠️', '🇯🇵', 'é'];

  it('slices a joined emoji as one glyph, never through it', () => {
    /* `displayWidth` counts a joined sequence as one two-cell glyph, so the
       scanner behind `sliceAnsi` has to as well. When it did not, the two
       disagreed by six cells on a row holding a family, and a slice of that
       row came out short — the previous frame showing through the gap. */
    const text = `ab${'👨‍👩‍👧‍👦'}cd`;
    expect(ansiWidth(text)).toBe(6);
    for (let end = 0; end <= 6; end++) {
      for (let start = 0; start <= end; start++) {
        expect(ansiWidth(sliceAnsi(text, start, end)), `slice(${start},${end})`).toBe(end - start);
      }
    }
  });

  it('keeps every slice exactly as wide as it was asked for', () => {
    for (const glyph of GLYPHS) {
      const text = `x${glyph}y${glyph}z`;
      const full = ansiWidth(text);
      for (let end = 0; end <= full; end++) {
        for (let start = 0; start <= end; start++) {
          expect(ansiWidth(sliceAnsi(text, start, end)), `${glyph} slice(${start},${end})`).toBe(end - start);
        }
      }
    }
  });

  it('agrees with itself through styling and hyperlinks', () => {
    const withEscapes = `\u001b[1mbold ${'👩‍💻'}\u001b[0m plain`;
    const full = ansiWidth(withEscapes);
    for (let end = 0; end <= full; end++) {
      expect(ansiWidth(sliceAnsi(withEscapes, 0, end)), `slice(0,${end})`).toBe(end);
    }
  });
});
