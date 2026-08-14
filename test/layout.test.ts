import { describe, expect, it } from 'vitest';
import { ansiWidth, stripAnsi } from '../src/core/ansi.js';
import { layoutDoc } from '../src/md/layout.js';
import { fixture, FIXTURES, opts } from './helpers.js';

const WIDTHS = [40, 60, 80, 100, 160, 200];

describe('I-1 no rendered row exceeds the terminal width', () => {
  for (const name of FIXTURES) {
    for (const width of WIDTHS) {
      for (const maxWidth of [88, 0]) {
        it(`I-1 ${name} at ${width} cols, maxWidth ${maxWidth}`, () => {
          const doc = layoutDoc(fixture(name), opts({ width, maxWidth }));
          const over = doc.lines
            .map((l, i) => ({ i, w: ansiWidth(l.ansi), text: stripAnsi(l.ansi) }))
            .filter((l) => l.w > width);
          expect(over).toEqual([]);
        });
      }
    }
  }
});

describe('I-2 layout measures in display cells, not code units', () => {
  it('I-2 aligns a table of wide characters', () => {
    const doc = layoutDoc(fixture('wide-chars.md'), opts({ width: 100 }));
    const borders = doc.lines.filter((l) => /^[\s]*[┌├└]/.test(stripAnsi(l.ansi)));
    const rows = doc.lines.filter((l) => /^[\s]*│/.test(stripAnsi(l.ansi)));
    expect(borders.length).toBeGreaterThan(0);
    const widths = new Set([...borders, ...rows].map((l) => ansiWidth(l.ansi)));
    // Every row of one table is exactly as wide as its rules.
    expect(widths.size).toBe(1);
  });

  it('I-2 counts a variation-selector emoji as two cells', () => {
    const doc = layoutDoc('⚠️ x', opts({ width: 40, maxWidth: 0 }));
    expect(ansiWidth(doc.lines[0]!.ansi)).toBe(2 + 2 + 1 + 1); // margin, emoji, space, x
  });
});

describe('I-3 layout is a pure function of (source, width, theme)', () => {
  for (const name of FIXTURES) {
    it(`I-3 ${name} renders identically twice`, () => {
      const a = layoutDoc(fixture(name), opts());
      const b = layoutDoc(fixture(name), opts());
      expect(a.lines.map((l) => l.ansi)).toEqual(b.lines.map((l) => l.ansi));
      expect(a.toc).toEqual(b.toc);
    });
  }

  it('I-3 a different width produces a different, still-valid document', () => {
    const narrow = layoutDoc(fixture('kitchen-sink.md'), opts({ width: 60 }));
    const wide = layoutDoc(fixture('kitchen-sink.md'), opts({ width: 160 }));
    expect(narrow.lines.length).toBeGreaterThan(wide.lines.length);
    expect(narrow.toc.map((t) => t.text)).toEqual(wide.toc.map((t) => t.text));
  });
});

describe('layout structure', () => {
  it('lifts front matter out of the body', () => {
    const doc = layoutDoc(fixture('kitchen-sink.md'), opts());
    const text = doc.lines.map((l) => l.plain).join('\n');
    expect(text).toContain('The Kitchen Sink');
    expect(text).not.toContain('---\ntitle:');
  });

  it('records every heading in the table of contents, in order', () => {
    const doc = layoutDoc(fixture('kitchen-sink.md'), opts());
    expect(doc.toc[0]).toMatchObject({ level: 1, text: 'folio' });
    expect(doc.toc.map((t) => t.line)).toEqual(doc.toc.map((t) => t.line).toSorted((a, b) => a - b));
    for (const entry of doc.toc) {
      expect(doc.lines[entry.line]?.heading?.text).toBe(entry.text);
    }
  });

  it('starts and ends with content, never blank rows', () => {
    for (const name of FIXTURES) {
      const doc = layoutDoc(fixture(name), opts());
      expect(doc.lines[0]!.plain.trim()).not.toBe('');
      expect(doc.lines[doc.lines.length - 1]!.plain.trim()).not.toBe('');
    }
  });

  it('never leaves two blank rows in a row', () => {
    const doc = layoutDoc(fixture('nesting.md'), opts());
    for (let i = 1; i < doc.lines.length; i++) {
      const blankPair =
        doc.lines[i]!.plain.trim() === '' && doc.lines[i - 1]!.plain.trim() === '';
      expect(blankPair).toBe(false);
    }
  });

  it('assigns monotonically non-decreasing block indices, for resize anchoring (I-6)', () => {
    const doc = layoutDoc(fixture('kitchen-sink.md'), opts());
    for (let i = 1; i < doc.lines.length; i++) {
      expect(doc.lines[i]!.block).toBeGreaterThanOrEqual(doc.lines[i - 1]!.block);
    }
  });
});

describe('I-11 output without colour is clean and readable', () => {
  for (const name of FIXTURES) {
    it(`I-11 ${name} emits no escapes at level 0`, () => {
      const doc = layoutDoc(fixture(name), opts({ level: 0 }));
      for (const line of doc.lines) {
        expect(line.ansi).not.toMatch(/\x1b/);
        expect(line.ansi).toBe(line.ansi.replace(/\s+$/, ''));
      }
    });
  }

  it('I-11 keeps task state legible without colour', () => {
    const doc = layoutDoc('- [x] done\n- [ ] todo\n', opts({ level: 0 }));
    const text = doc.lines.map((l) => l.plain).join('\n');
    expect(text).toContain('☑');
    expect(text).toContain('☐');
  });
});

describe('degenerate input', () => {
  it('handles an empty document', () => {
    const doc = layoutDoc('', opts());
    expect(doc.lines).toEqual([]);
    expect(doc.toc).toEqual([]);
  });

  it('handles whitespace-only input', () => {
    expect(layoutDoc('\n\n   \n\n', opts()).lines).toEqual([]);
  });

  it('survives a terminal narrower than the minimum text column', () => {
    const doc = layoutDoc(fixture('kitchen-sink.md'), opts({ width: 20 }));
    expect(doc.lines.length).toBeGreaterThan(0);
    for (const l of doc.lines) expect(ansiWidth(l.ansi)).toBeLessThanOrEqual(20);
  });
});

describe('I-16 column alignment survives wrapping', () => {
  it('I-16 aligns front-matter values in one column', () => {
    const doc = layoutDoc(fixture('kitchen-sink.md'), opts({ level: 0, width: 100 }));
    const rows = doc.lines.slice(0, 4).map((l) => l.plain);
    const columns = rows.map((r) => r.indexOf(r.trim().split(/\s{2,}/)[1] ?? ''));
    expect(new Set(columns).size).toBe(1);
  });

  it('I-16 aligns numbered link references', () => {
    const src = Array.from({ length: 12 }, (_, i) => `[link ${i}](https://example.com/${i})`).join('\n\n');
    const doc = layoutDoc(src, opts({ level: 0, links: 'ref' }));
    const refs = doc.lines.filter((l) => /^\s*\[\s*\d+\]/.test(l.plain));
    expect(refs).toHaveLength(12);
    const columns = refs.map((l) => l.plain.indexOf('https'));
    expect(new Set(columns).size).toBe(1);
  });

  it('renders link targets inline when OSC 8 is unavailable', () => {
    const doc = layoutDoc('[docs](https://example.com/x)', opts({ level: 0, links: 'plain' }));
    expect(doc.lines[0]!.plain).toContain('docs (https://example.com/x)');
  });
});

describe('I-13 a code block degrades rather than failing', () => {
  it('falls back to plain text when there is no highlighter', () => {
    const doc = layoutDoc('```klingon\nDaH jImej\n```\n', opts({ level: 0 }));
    expect(doc.lines.map((l) => l.plain).join('\n')).toContain('DaH jImej');
  });

  it('falls back when the highlighter returns nothing for the language', () => {
    const doc = layoutDoc('```js\nconst a = 1;\n```\n', opts({ level: 0, highlight: () => null }));
    expect(doc.lines.map((l) => l.plain).join('\n')).toContain('const a = 1;');
  });

  it('falls back when the highlighter returns the wrong number of rows', () => {
    const doc = layoutDoc(
      '```js\nconst a = 1;\nconst b = 2;\n```\n',
      opts({ level: 0, highlight: () => [[{ text: 'only one row', style: {} }]] }),
    );
    const text = doc.lines.map((l) => l.plain).join('\n');
    expect(text).toContain('const a = 1;');
    expect(text).toContain('const b = 2;');
  });
});
