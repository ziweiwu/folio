import { describe, expect, it } from 'vitest';
import { ansiWidth, stripAnsi } from '../src/core/ansi.js';
import { composeFrame, maxHOffset } from '../src/ui/chrome.js';
import { highlightRow } from '../src/core/search.js';
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

describe('I-18 a decorated row is still clipped by the viewport, not by the decorator', () => {
  /* `composeFrame` had never been called with a `decorate` callback anywhere in
     the suite, so the entire interaction between search/link highlighting and
     the viewport was unexercised — which is where this lived. */
  const doc = layoutDoc(WIDE, opts({ width: 60, overflow: 'scroll', level: 0 }));
  const row = doc.lines.findIndex((l) => l.plain.includes('docker run'));
  const state = { offset: 0, height: doc.lines.length, total: doc.lines.length, hOffset: 8 };

  it('I-18 never shortens the row it decorates, whatever width it is handed', () => {
    /* The guarantee has to hold for *any* width a caller passes, because the
       caller that had it wrong passed the viewport's. Clipping to the screen is
       `composeFrame`'s job and happens after this. */
    const wide = doc.lines[row]!.ansi;
    for (const w of [10, 59, ansiWidth(wide), 500]) {
      const lit = highlightRow(wide, doc.lines[row]!.plain, [{ start: 0, end: 5, style: { bold: true } }], w, 0);
      expect(ansiWidth(lit), `width ${w}`).toBe(ansiWidth(wide));
      expect(stripAnsi(lit), `width ${w}`).toBe(stripAnsi(wide));
    }
  });

  it('I-18 keeps a panned wide row intact when a match is highlighted on it', () => {
    const plain = composeFrame(doc, state, 60, theme, 0);
    const lit = composeFrame(doc, state, 60, theme, 0, (text, line) =>
      line === row ? highlightRow(text, doc.lines[line]!.plain, [{ start: 0, end: 5, style: { bold: true } }], 59, 0) : text,
    );
    /* Highlighting a match near the start of a 100+ cell row used to cut it to
       the viewport's width *before* the pan was applied, so the frame went
       blank exactly where the reader had scrolled to. */
    expect(stripAnsi(lit[row]!)).toBe(stripAnsi(plain[row]!));
    expect(stripAnsi(lit[row]!).trim()).not.toBe('');
  });

  it('I-10 a decorated frame is still exactly the terminal width', () => {
    for (const h of [0, 8, 40]) {
      const frame = composeFrame(doc, { ...state, hOffset: h }, 60, theme, 3, (text, line) =>
        line === row ? highlightRow(text, doc.lines[line]!.plain, [{ start: 0, end: 5, style: { bold: true } }], ansiWidth(text), 3) : text,
      );
      for (const [i, r] of frame.entries()) expect(ansiWidth(r), `h${h} row ${i}`).toBe(60);
    }
  });
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

describe('I-26 a row that is cut says so', () => {
  it('I-26 marks prose the viewport had to cut', () => {
    /* Below the layout engine's own minimum column the wrapper cannot make
       rows narrow enough, so the viewport clips them. Clipping in silence
       drops words mid-glyph with nothing to show it happened. */
    const doc = layoutDoc('A paragraph of ordinary prose, long enough to need cutting.\n', opts({ width: 12, overflow: 'wrap' }));
    const frame = composeFrame(doc, { offset: 0, height: doc.lines.length, total: doc.lines.length }, 12, theme, 0);
    const cut = frame.filter((row) => stripAnsi(row).trimEnd().endsWith('\u203a'));
    expect(cut.length).toBeGreaterThan(0);
    expect(new Set(frame.map(ansiWidth))).toEqual(new Set([12]));
  });

  it('I-26 marks a wide row with an edge marker, not an ellipsis', () => {
    // A wide row is scrollable, so it gets `›` — the rest is reachable.
    const doc = layoutDoc(WIDE, opts({ width: 40, overflow: 'scroll' }));
    const frame = composeFrame(doc, { offset: 0, height: doc.lines.length, total: doc.lines.length }, 40, theme, 0);
    const text = frame.map(stripAnsi).join('\n');
    expect(text).toContain('›');
  });

  it('I-26 never lets a marker push the frame past its width', () => {
    // The marker costs a cell, and at the terminal's floor there is none to
    // spare — drawing it anyway sheared the frame by one column.
    for (const width of [1, 2, 3, 4, 5, 8, 12, 20]) {
      for (const overflow of ['wrap', 'scroll'] as const) {
        const doc = layoutDoc(WIDE, opts({ width: Math.max(4, width - 1), overflow }));
        for (const hOffset of [0, 4, 40]) {
          const frame = composeFrame(
            doc,
            { offset: 0, height: 8, total: doc.lines.length, hOffset },
            width,
            theme,
            0,
          );
          expect(new Set(frame.map(ansiWidth)), `${width} cols, ${overflow}, h=${hOffset}`).toEqual(
            new Set([width]),
          );
        }
      }
    }
  });
});

/** A table with `n` columns of one character each. */
function many(n: number): string {
  const head = Array.from({ length: n }, (_, i) => `c${i}`).join('|');
  const sep = Array.from({ length: n }, () => '---').join('|');
  const row = Array.from({ length: n }, (_, i) => `${i}`).join('|');
  return `|${head}|\n|${sep}|\n|${row}|\n`;
}

describe('I-19 --wrap does not leave a row scrollable', () => {
  /* A table with enough columns defeats the column solver: the frame alone
     costs three cells per column, so no amount of shrinking fits it. Under
     `wrap` the reader asked for it to be chopped, so it must not also be
     offered as something to scroll sideways over. */

  it('I-19 marks an over-wide table scrollable only in scroll mode', () => {
    for (const n of [15, 20, 30]) {
      const scroll = layoutDoc(many(n), opts({ width: 80, overflow: 'scroll' }));
      const wrap = layoutDoc(many(n), opts({ width: 80, overflow: 'wrap' }));
      expect(scroll.lines.some((l) => l.wide === true), `${n} cols, scroll`).toBe(true);
      expect(wrap.lines.some((l) => l.wide === true), `${n} cols, wrap`).toBe(false);
    }
  });

  it('I-19 offers no sideways room under --wrap', () => {
    const doc = layoutDoc(many(20), opts({ width: 80, overflow: 'wrap' }));
    const state = { offset: 0, height: doc.lines.length, total: doc.lines.length };
    // Nothing to scroll to, so `l` must not move the viewport at all.
    expect(maxHOffset(doc, state, 80)).toBe(0);
  });

  it('I-19 still offers sideways room under scroll', () => {
    const doc = layoutDoc(many(20), opts({ width: 80, overflow: 'scroll' }));
    const state = { offset: 0, height: doc.lines.length, total: doc.lines.length };
    expect(maxHOffset(doc, state, 80)).toBeGreaterThan(0);
  });

  it('I-26 chops the over-wide table with a mark under --wrap', () => {
    const doc = layoutDoc(many(20), opts({ width: 80, overflow: 'wrap' }));
    const frame = composeFrame(
      doc,
      { offset: 0, height: doc.lines.length, total: doc.lines.length },
      80,
      theme,
      0,
    );
    expect(new Set(frame.map(ansiWidth))).toEqual(new Set([80]));
    expect(frame.some((r) => stripAnsi(r).includes('\u203a'))).toBe(true);
  });
});

describe('I-26 the cut mark does not depend on colour', () => {
  it('I-26 marks a cut row distinguishably with colour stripped', () => {
    /* An ellipsis was the obvious choice and the wrong one: with `paint` a
       no-op at level 0, an app-inserted `…` is byte-identical to one the author
       typed, so a NO_COLOR reader cannot tell the viewer's mark from the
       document's own text. A mark that only exists in colour is no mark. */
    const width = 16;
    const src = '# T\n\nreal ellipsis here…\n\nA line long enough that it will certainly not fit.\n';
    const doc = layoutDoc(src, opts({ width, level: 0, overflow: 'wrap' }));
    const frame = composeFrame(
      doc,
      { offset: 0, height: doc.lines.length, total: doc.lines.length },
      width,
      theme,
      0,
    );

    const body = width - 1;
    let marked = 0;
    doc.lines.forEach((line, i) => {
      if (ansiWidth(line.ansi) <= body) return;
      // This row had to be cut, so it must say so — and not with an ellipsis,
      // which is indistinguishable from the document's own punctuation here.
      const row = stripAnsi(frame[i]!).trimEnd();
      expect(row.endsWith('\u203a'), `row ${i}: ${row}`).toBe(true);
      expect(row.endsWith('…'), `row ${i}: ${row}`).toBe(false);
      marked++;
    });
    expect(marked, 'the fixture should produce at least one cut row').toBeGreaterThan(0);

    // The author's own ellipsis is content, and survives untouched.
    expect(frame.map(stripAnsi).join('\n')).toContain('…');
  });
});
