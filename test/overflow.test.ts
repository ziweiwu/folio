import { describe, expect, it } from 'vitest';
import { ansiWidth, stripAnsi } from '../src/core/ansi.js';
import { composeFrame, maxHOffset } from '../src/ui/chrome.js';
import { layoutDoc } from '../src/md/layout.js';
import { pickTheme } from '../src/ui/theme.js';
import { fixture, FIXTURES, opts } from './helpers.js';

const theme = pickTheme('dark');

const WIDE = `# Wide

\`\`\`bash
docker run --rm -it -v "$PWD:/work" --env FOO=bar ghcr.io/example/image:v1 sh -lc 'echo a very long command'
short
\`\`\`

| one | a much longer column of prose that will not fit at all | n |
|---|---|---|
| a | this row also carries a good deal of text in it indeed | 1 |
`;

describe('I-18 a composed frame never exceeds the terminal, in either overflow mode', () => {
  for (const overflow of ['wrap', 'scroll'] as const) {
    for (const name of FIXTURES) {
      it(`I-18 ${name}, ${overflow}`, () => {
        for (const width of [40, 80, 100, 160]) {
          const doc = layoutDoc(fixture(name), opts({ width: width - 1, overflow }));
          for (const hOffset of [0, 20, 400]) {
            const rows = composeFrame(
              doc,
              { offset: 0, height: 30, total: doc.lines.length, hOffset },
              width, theme, 3,
            );
            expect(new Set(rows.map(ansiWidth))).toEqual(new Set([width]));
          }
        }
      });
    }
  }
});

describe('wide content scrolls sideways instead of being chopped', () => {
  const scroll = layoutDoc(WIDE, opts({ width: 75, overflow: 'scroll', level: 0 }));
  const wrap = layoutDoc(WIDE, opts({ width: 75, overflow: 'wrap', level: 0 }));

  it('keeps a long command on one row instead of folding it', () => {
    const scrolled = scroll.lines.find((l) => l.plain.includes('docker run'))!;
    const wrapped = wrap.lines.find((l) => l.plain.includes('docker run'))!;
    expect(scroll.lines.filter((l) => l.plain.includes('docker run'))).toHaveLength(1);
    expect(scrolled.plain.length).toBeGreaterThan(wrapped.plain.length);
    // Wrapping produces more rows for the same block; scrolling produces wider ones.
    expect(scroll.lines.length).toBeLessThan(wrap.lines.length);
  });

  it('marks code and table rows wide, and leaves prose alone', () => {
    expect(scroll.lines.find((l) => l.plain.includes('docker run'))!.wide).toBe(true);
    expect(scroll.lines.find((l) => l.plain.includes('Wide'))!.wide).toBeUndefined();
    expect(wrap.lines.find((l) => l.plain.includes('docker run'))!.wide).toBeUndefined();
  });

  it('never truncates a table cell that the reader could scroll to instead', () => {
    // 50 columns is narrow enough that wrapping has to cut the prose column.
    const narrowScroll = layoutDoc(WIDE, opts({ width: 50, overflow: 'scroll', level: 0 }));
    const narrowWrap = layoutDoc(WIDE, opts({ width: 50, overflow: 'wrap', level: 0 }));
    expect(narrowScroll.lines.some((l) => l.plain.includes('will not fit at all'))).toBe(true);
    expect(narrowWrap.lines.some((l) => l.plain.includes('…'))).toBe(true);
    expect(narrowWrap.lines.some((l) => l.plain.includes('will not fit at all'))).toBe(false);
  });

  it('I-19 shifts only the wide rows, so prose stays where it was being read', () => {
    const doc = layoutDoc(WIDE, opts({ width: 75, overflow: 'scroll' }));
    const at = (h: number) =>
      composeFrame(doc, { offset: 0, height: 20, total: doc.lines.length, hOffset: h }, 76, theme, 0);
    const heading = doc.lines.findIndex((l) => l.plain.includes('Wide'));
    expect(stripAnsi(at(0)[heading]!)).toBe(stripAnsi(at(40)[heading]!));

    const command = doc.lines.findIndex((l) => l.plain.includes('docker run'));
    expect(stripAnsi(at(40)[command]!)).not.toBe(stripAnsi(at(0)[command]!));
    expect(stripAnsi(at(40)[command]!)).toContain('ghcr.io');
  });

  it('says so at whichever edge the content continues past', () => {
    const doc = layoutDoc(WIDE, opts({ width: 75, overflow: 'scroll' }));
    const rows = (h: number) =>
      composeFrame(doc, { offset: 0, height: 20, total: doc.lines.length, hOffset: h }, 76, theme, 0)
        .map(stripAnsi)
        .join('\n');
    expect(rows(0)).toContain('›');
    expect(rows(0)).not.toContain('‹');
    expect(rows(40)).toContain('‹');
  });

  it('bounds the shift by the widest row actually on screen', () => {
    const doc = layoutDoc(WIDE, opts({ width: 75, overflow: 'scroll' }));
    const all = maxHOffset(doc, { offset: 0, height: 30, total: doc.lines.length }, 76);
    expect(all).toBeGreaterThan(0);
    // The heading alone is not wide, so there is nowhere to go from there.
    const headingOnly = maxHOffset(doc, { offset: 0, height: 1, total: doc.lines.length }, 76);
    expect(headingOnly).toBe(0);
  });

  it('wrap mode is unaffected by a horizontal offset', () => {
    const doc = layoutDoc(WIDE, opts({ width: 75, overflow: 'wrap' }));
    const at = (h: number) =>
      composeFrame(doc, { offset: 0, height: 20, total: doc.lines.length, hOffset: h }, 76, theme, 0).map(stripAnsi);
    expect(at(40)).toEqual(at(0));
    expect(maxHOffset(doc, { offset: 0, height: 30, total: doc.lines.length }, 76)).toBe(0);
  });
});
