import { describe, expect, it } from 'vitest';
import { ansiWidth, stripAnsi } from '../src/core/ansi.js';
import { layoutDoc } from '../src/md/layout.js';
import { sanitizeLine, sanitizeSource } from '../src/core/sanitize.js';
import { clusters, displayWidth, truncate } from '../src/core/width.js';
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

  it('I-2 advances by cluster, so a mark cannot be counted apart from its base', () => {
    /* `displayWidth` is stateful — U+FE0F widens the character before it — so
       summing it per code point is not the same as calling it on the string.
       Every scanner that walked one accumulating width under-counted, and the
       rows it produced ran past the frame. */
    for (const [text, cells] of [
      ['⚠️', 2],
      ['a⚠️', 3],
      ['é', 1], // e + U+0301
      ['1️⃣', 2], // digit + U+FE0F + U+20E3
    ] as const) {
      expect(displayWidth(text), text).toBe(cells);
      expect([...clusters(text)].reduce((n, [, w]) => n + w, 0), text).toBe(cells);
      // The cut never lands between a base and the marks bound to it.
      expect([...clusters(text)].map(([c]) => c).join('')).toBe(text);
    }
  });

  it('I-1 keeps prose within the frame when every word carries a mark', () => {
    // 56 cells at 40 columns before the scanners advanced by cluster.
    for (const width of WIDTHS) {
      const doc = layoutDoc(`# T\n\n${'a⚠️'.repeat(80)}\n`, opts({ width, maxWidth: 0 }));
      const over = doc.lines.map((l) => ansiWidth(l.ansi)).filter((w) => w > width);
      expect(over, `${width} cols`).toEqual([]);
    }
  });

  it('I-2 truncates by cluster, never mid-glyph', () => {
    for (let max = 2; max <= 12; max++) {
      const cut = truncate('⚠️'.repeat(8), max);
      expect(displayWidth(cut), `max ${max}`).toBeLessThanOrEqual(max);
      expect(cut.startsWith('\uFE0F')).toBe(false);
    }
  });
});

describe('I-1 front matter keys are measured in cells', () => {
  it('I-1 cuts a key wider than its column instead of overrunning the row', () => {
    /* `padSpans` can only add, so a key longer than the column it was measured
       against pushed its value flush against itself and carried the row past
       the frame — 52 cells at 40 columns, with no separator at all. */
    const src = '---\na-really-very-long-front-matter-key-name: value here\nurl: https://x\n---\n\n# T\n';
    const doc = layoutDoc(src, opts({ width: 40, maxWidth: 0 }));
    expect(doc.lines.map((l) => ansiWidth(l.ansi)).filter((w) => w > 40)).toEqual([]);
    const row = doc.lines.map((l) => stripAnsi(l.ansi)).find((t) => t.includes('value here'))!;
    expect(row).toContain('…');
    expect(row).toMatch(/…\s+value here/); // the separator survives
  });

  it('I-2 aligns a CJK key on cells, not on code units', () => {
    const doc = layoutDoc('---\n作者名前欄目: someone\nurl: https://x\n---\n\n# T\n', opts({ width: 40, maxWidth: 0 }));
    const rows = doc.lines.map((l) => stripAnsi(l.ansi));
    const cjk = rows.find((t) => t.includes('someone'))!;
    const url = rows.find((t) => t.includes('https://x'))!;
    // Both values start in the same column, measured in cells.
    expect(displayWidth(cjk.slice(0, cjk.indexOf('someone')))).toBe(
      displayWidth(url.slice(0, url.indexOf('https://x'))),
    );
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

describe('I-29 a document is content, never instructions', () => {
  /* Escape bytes are written with \x escapes rather than literally, so this
     file stays readable in the terminal it is testing. */
  const ESC = '\x1b';
  const BEL = '\x07';

  const CASES: ReadonlyArray<readonly [string, string]> = [
    ['clears the screen', `# T\n\nbefore ${ESC}[2J${ESC}[H after\n`],
    ['inside a code fence', `\`\`\`\nbefore ${ESC}[2J${ESC}[H after\n\`\`\`\n`],
    ['forges an OSC 8 target', `# T\n\n${ESC}]8;;https://evil.example${BEL}click${ESC}]8;;${BEL}\n`],
    ['rings the bell', `# T\n\nbell${BEL} here\n`],
    ['overwrites the row', '# T\n\nvisible\rHIDDEN\n'],
    ['in front matter', `---\ntitle: ${ESC}[2J\n---\n\n# T\n`],
    ['in a table cell', `| a | b |\n|---|---|\n| ${ESC}[2J | x |\n`],
    ['in a heading', `# Head${ESC}[2Jing\n`],
    ['in a link target', `# T\n\n[text](./a${ESC}[2Jb.md)\n`],
  ];

  for (const [what, src] of CASES) {
    for (const level of [0, 3] as const) {
      it(`I-29 neutralises a sequence that ${what} (level ${level})`, () => {
        const doc = layoutDoc(src, opts({ level, overflow: 'wrap' }));
        for (const line of doc.lines) {
          // At level 0 there should be no escape at all. At level 3 the only
          // escapes allowed are the ones this viewer emitted itself, so the
          // *plain* text — what the document actually said — must be clean.
          expect(line.plain).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
          if (level === 0) expect(line.ansi).not.toMatch(/\x1b/);
        }
      });
    }
  }

  it('I-29 shows a neutralised byte rather than deleting it', () => {
    // A document containing an escape is not the same document as one that
    // does not; caret notation is what every pager already uses.
    const doc = layoutDoc(`# T\n\nsee ${ESC}[2J here\n`, opts({ level: 0, overflow: 'wrap' }));
    expect(doc.lines.map((l) => l.plain).join('\n')).toContain('^[');
  });

  it('I-29 expands a tab rather than passing it through or escaping it', () => {
    /* A tab has no width of its own — it means "advance to the next tab stop",
       which `displayWidth` cannot know. Counted as zero here and as up to eight
       columns by the terminal, it made the arithmetic and the screen disagree,
       and the right border of a code block landed in the wrong column. */
    const doc = layoutDoc('# T\n\n```\n\tindented\n\t\tmore\n```\n', opts({ level: 0, overflow: 'wrap' }));
    const text = doc.lines.map((l) => l.plain).join('\n');
    expect(text).not.toContain('\t');
    expect(text).not.toContain('^I');
    expect(text).toContain('    indented');
  });

  it('I-2 measures a tab stop in cells, carrying variation selectors', () => {
    /* Width is not a property of a single character. `U+FE0F` widens the glyph
       *before* it, so `displayWidth` carries state across the string — and
       measuring one character at a time throws that away, which put every tab
       after an emoji at the wrong stop. */
    const TAB = String.fromCharCode(9);
    const prefixes = [
      '⚠️', '⚠️⚠️', '⚠️⚠️⚠️', 'x⚠️', 'ab', '中', '中x', '👍', '✅✅', '',
      // Whatever `displayWidth` makes of a cluster, expansion must agree with
      // it — the two must never disagree about where a column is.
      '👍🏽', '👨‍👩‍👧‍👦', '🇯🇵', 'é', '1️⃣', 'العربية', 'x⚠️中👍',
    ];
    for (const prefix of prefixes) {
      const out = sanitizeSource(`${prefix}${TAB}after`);
      const spaces = out.length - prefix.length - 'after'.length;
      const want = 4 - (displayWidth(prefix) % 4);
      expect(spaces, `${JSON.stringify(prefix)} is ${displayWidth(prefix)} cells`).toBe(want);
      // And the expansion lands the text on a real tab stop.
      expect(
        displayWidth(out.slice(0, out.length - 'after'.length)) % 4,
        `${JSON.stringify(prefix)} did not land on a stop`,
      ).toBe(0);
    }
  });

  it('I-29 expands a tab wherever it sits on the line', () => {
    const TAB = String.fromCharCode(9);
    expect(sanitizeSource(`${TAB}x`)).toBe('    x');
    expect(sanitizeSource(`x${TAB}`)).toBe('x   ');
    expect(sanitizeSource(TAB)).toBe('    ');
    expect(sanitizeSource(`x${TAB}${TAB}y`)).toBe('x       y');
    expect(sanitizeSource('')).toBe('');
  });

  it('I-29 expands tabs to real stops, not a fixed run of spaces', () => {
    expect(sanitizeSource('a\tb')).toBe('a   b');
    expect(sanitizeSource('ab\tc')).toBe('ab  c');
    expect(sanitizeSource('abc\td')).toBe('abc d');
    expect(sanitizeSource('abcd\te')).toBe('abcd    e');
    // Measured in cells, so a wide glyph advances the column by two.
    expect(sanitizeSource('中\tx')).toBe('中  x');
    // Each line starts a new count.
    expect(sanitizeSource('ab\n\tc')).toBe('ab\n    c');
  });

  it('I-29 leaves every legitimate character alone', () => {
    /* The risk with any input filter is that it eats content it should not.
       These are all things a real document contains, and none of them is a
       control byte however unusual it looks. */
    for (const text of [
      '中文字符测试',
      '👍🏽 family 👨‍👩‍👧‍👦 flag 🇯🇵',
      'é à ñ',
      '⚠️ ⛔ ✅',
      'العربية עברית',
      '∀x∈ℝ: x²≥0',
      '┌─┬─┐│├┼┤└┴┘',
    ]) {
      expect(sanitizeSource(text), text).toBe(text);
    }
  });

  it('I-29 writes a neutralised byte in caret notation', () => {
    expect(sanitizeSource('a\x1bb')).toBe('a^[b');
    expect(sanitizeSource('a\x07b')).toBe('a^Gb');
    expect(sanitizeSource('a\rb')).toBe('a^Mb');
    expect(sanitizeSource('a\x00b')).toBe('a^@b');
    expect(sanitizeSource('a\x7fb')).toBe('a^?b');
    expect(sanitizeSource('a\nb')).toBe('a\nb');
  });

  it('I-29 neutralises a filename used as chrome', () => {
    // A file can be *named* with an escape sequence, and the bar prints it.
    expect(sanitizeLine('re\x1b[2Jadme.md')).toBe('re^[[2Jadme.md');
    expect(sanitizeLine('plain.md')).toBe('plain.md');
  });

  it('I-29 renders a tab-indented document the same as a space-indented one', () => {
    /* Expanding tabs happens before the markdown is parsed, so the risk is
       that it changes what the *parser* sees — indentation is structure in
       markdown. Against real tab stops it does not: a tab means exactly the
       columns it advances, which is what CommonMark says it means. */
    const TAB = String.fromCharCode(9);
    const pairs: ReadonlyArray<readonly [string, string]> = [
      [`- one\n${TAB}- two\n${TAB}${TAB}- three\n`, '- one\n    - two\n        - three\n'],
      [`para\n\n${TAB}code line\n${TAB}more code\n`, 'para\n\n    code line\n    more code\n'],
      [`\`\`\`\nif x:\n${TAB}return 1\n\`\`\`\n`, '```\nif x:\n    return 1\n```\n'],
      [`1. first\n\n${TAB}continued\n\n2. second\n`, '1. first\n\n    continued\n\n2. second\n'],
    ];
    for (const [tabbed, spaced] of pairs) {
      const a = layoutDoc(tabbed, opts({ level: 0, overflow: 'wrap' })).lines.map((l) => l.plain);
      const b = layoutDoc(spaced, opts({ level: 0, overflow: 'wrap' })).lines.map((l) => l.plain);
      expect(a, JSON.stringify(tabbed)).toEqual(b);
    }
  });

  it('I-29 lets no raw tab reach a row by any path', () => {
    const TAB = String.fromCharCode(9);
    const src = [
      `# Head${TAB}ing`,
      '',
      `para with${TAB}a tab`,
      '',
      `- list${TAB}item`,
      '',
      '```',
      `${TAB}fenced`,
      '```',
      '',
      '| a | b |',
      '|---|---|',
      `| x${TAB}y | z |`,
      '',
      `> quote${TAB}here`,
      '',
    ].join('\n');
    for (const overflow of ['wrap', 'scroll'] as const) {
      const doc = layoutDoc(src, opts({ level: 0, overflow }));
      for (const line of doc.lines) {
        expect(line.plain, `overflow ${overflow}`).not.toContain(TAB);
        expect(line.ansi, `overflow ${overflow}`).not.toContain(TAB);
      }
    }
  });

  it('I-29 does not turn a CRLF file into a wall of ^M', () => {
    const doc = layoutDoc('# T\r\n\r\none\r\ntwo\r\n', opts({ level: 0, overflow: 'wrap' }));
    expect(doc.lines.map((l) => l.plain).join('\n')).not.toContain('^M');
  });
});
