import { describe, expect, it, vi } from 'vitest';
import { createCoalescer } from '../src/core/coalesce.js';
import { ansiWidth, stripAnsi } from '../src/core/ansi.js';
import { findMatches, highlightRow, isCaseSensitive, nextMatch, stepMatch } from '../src/core/search.js';
import { parseArgs } from '../src/core/options.js';
import { parseBurst, splitBurst } from '../src/core/keys.js';
import { anchorOffset, clampOffset, maxOffset } from '../src/core/position.js';
import { composeFrame, scrollPercent, scrollbar, sectionAt, statusBar } from '../src/ui/chrome.js';
import { centre, overlayRows } from '../src/ui/overlay.js';
import { helpPane, tocPane } from '../src/ui/panes.js';
import { layoutDoc } from '../src/md/layout.js';
import { isMarkdownPath, layoutText, looksBinary, nestsTooDeeply } from '../src/md/text.js';
import { pickTheme } from '../src/ui/theme.js';
import { fixture, opts } from './helpers.js';

const theme = pickTheme('dark');

describe('I-9 scrolling coalesces to one update per frame', () => {
  it('I-9 applies the first event immediately, so a single key is instant', () => {
    const flush = vi.fn();
    const c = createCoalescer({ frameMs: 16, flush, setTimer: () => 1, clearTimer: () => {} });
    c.push(1);
    expect(flush).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('I-9 collapses a burst of keys into two updates, not one per key', () => {
    const flush = vi.fn();
    let fire: (() => void) | null = null;
    const c = createCoalescer({
      frameMs: 16,
      flush,
      setTimer: (fn) => {
        fire = fn;
        return 1;
      },
      clearTimer: () => {},
    });

    for (let i = 0; i < 30; i++) c.push(1);
    // Leading edge only, so far.
    expect(flush).toHaveBeenCalledTimes(1);
    fire!();
    // ...then one trailing update carrying the other 29 lines.
    expect(flush).toHaveBeenCalledTimes(2);
    expect(flush).toHaveBeenLastCalledWith(29);
  });

  it('I-9 an idle period does not emit an empty update', () => {
    const flush = vi.fn();
    let fire: (() => void) | null = null;
    const c = createCoalescer({
      frameMs: 16, flush,
      setTimer: (fn) => { fire = fn; return 1; },
      clearTimer: () => {},
    });
    c.push(3);
    fire!();
    expect(flush).toHaveBeenCalledTimes(1);
  });

  it('discards pending deltas when an absolute jump supersedes them', () => {
    const flush = vi.fn();
    const c = createCoalescer({ frameMs: 16, flush, setTimer: () => 1, clearTimer: () => {} });
    c.push(1);
    c.push(5);
    c.discard();
    expect(flush).toHaveBeenCalledTimes(1);
  });
});

describe('I-10 the viewport draws a fixed number of rows', () => {
  const doc = layoutDoc(fixture('large.md'), opts({ width: 100 }));

  it('I-10 a 10k-row document composes exactly as many rows as the terminal has', () => {
    expect(doc.lines.length).toBeGreaterThan(3000);
    for (const height of [5, 24, 60]) {
      const rows = composeFrame(doc, { offset: 0, height, total: doc.lines.length }, 100, theme, 3);
      expect(rows).toHaveLength(height);
    }
  });

  it('I-10 composing a frame costs far less than drawing one', () => {
    const FRAMES = 200;
    const run = () => {
      const t0 = process.hrtime.bigint();
      for (let i = 0; i < FRAMES; i++) {
        composeFrame(doc, { offset: i, height: 40, total: doc.lines.length }, 100, theme, 3);
      }
      return Number(process.hrtime.bigint() - t0) / 1e6 / FRAMES;
    };
    /* Min-of-3, not median: a wall-clock measurement inflates under load, and a
       test suite runs precisely when the machine is loaded, so the minimum is
       the least-contended sample and still an upper bound. */
    const msPerFrame = Math.min(run(), run(), run());
    // An Ink frame costs ~30ms to draw. Composing it must disappear next to
    // that, or scrolling a long document would cost more than a short one.
    expect(msPerFrame).toBeLessThan(3);
  });

  it('I-5 clamps the offset past the end rather than drawing blanks', () => {
    const rows = composeFrame(doc, { offset: 0, height: 10, total: doc.lines.length }, 100, theme, 3);
    expect(rows.every((r) => ansiWidth(r) === 100)).toBe(true);
  });

  it('pads every row to the full width, so no previous frame shows through', () => {
    for (const width of [40, 80, 200]) {
      const rows = composeFrame(doc, { offset: 12, height: 8, total: doc.lines.length }, width, theme, 3);
      expect(new Set(rows.map(ansiWidth))).toEqual(new Set([width]));
    }
  });
});

describe('scrollbar', () => {
  it('fills the gutter with blanks when the document fits', () => {
    const bar = scrollbar({ offset: 0, height: 20, total: 12 }, theme, 0);
    expect(bar.join('')).toBe(' '.repeat(20));
  });

  it('puts the thumb at the top at the top and the bottom at the bottom', () => {
    const top = scrollbar({ offset: 0, height: 10, total: 100 }, theme, 0);
    const bottom = scrollbar({ offset: 90, height: 10, total: 100 }, theme, 0);
    expect(top[0]).toBe('┃');
    expect(top[9]).toBe('│');
    expect(bottom[9]).toBe('┃');
    expect(bottom[0]).toBe('│');
  });

  it('never loses the thumb entirely on a very long document', () => {
    const bar = scrollbar({ offset: 5000, height: 30, total: 100000 }, theme, 0);
    expect(bar.filter((c) => c === '┃').length).toBeGreaterThanOrEqual(1);
  });
});

describe('status bar', () => {
  const info = { name: 'README.md', section: '## Install', offset: 40, height: 20, total: 200, hints: ['q quit'] };

  it('is exactly the terminal width at every size', () => {
    for (const width of [24, 40, 80, 100, 200]) {
      expect(ansiWidth(statusBar(info, width, theme, 3))).toBe(width);
    }
  });

  it('drops the hints before it drops the filename', () => {
    const long = { ...info, hints: ['/ search', 't toc', '? keys', 'q quit'] };
    const wide = stripAnsi(statusBar(long, 100, theme, 0));
    expect(wide).toContain('README.md');
    expect(wide).toContain('q quit');

    const narrow = stripAnsi(statusBar(long, 30, theme, 0));
    expect(narrow).toContain('README.md');
    // The legend gives way an item at a time, from the front, so what is left
    // at 30 columns is the escape hatch and nothing else.
    expect(narrow).not.toContain('/ search');
    expect(narrow).toContain('q quit');
  });

  it('drops the legend from the front, so q and ? outlive the rest', () => {
    /* It used to be shown whole or not at all, which left every terminal under
       65 columns — an ordinary tmux split — with no legend and no `?` with
       which to find one. The panes had degraded gracefully all along. */
    const long = { ...info, hints: ['/ search', 't toc', '? keys', 'q quit'] };
    const at = (w: number) => stripAnsi(statusBar(long, w, theme, 0));

    expect(at(30)).toContain('q quit');
    expect(at(40)).toContain('? keys   q quit');
    expect(at(60)).toContain('/ search   t toc   ? keys   q quit');

    /* Whatever is shown is always a whole *suffix* of the legend — never a
       partial item, and never a gap in the middle. Half of `? keys` is not a
       hint, it is noise. */
    const items = ['/ search', 't toc', '? keys', 'q quit'];
    const suffixes = items.map((_, i) => items.slice(i).join('   '));
    for (let w = 20; w <= 100; w++) {
      const shown = stripAnsi(statusBar(long, w, theme, 0)).trimEnd();
      if (items.some((item) => shown.includes(item))) {
        expect(suffixes.some((suffix) => shown.endsWith(suffix)), `${w} cols: ${shown}`).toBe(true);
      }
      expect(ansiWidth(statusBar(long, w, theme, 3)), `${w} cols`).toBe(w);
    }
  });

  it('I-26 keeps the escape hatch at the narrowest usable terminal', () => {
    /* The promise is that `q quit` outlives everything else, and it did not:
       the name and the percentage were sized first and the legend was offered
       what remained, so below about 27 columns there was nothing remaining and
       the bar showed no legend at all — on a tmux split, which is exactly the
       terminal the rule was written for. The name gives way first, then the
       percentage; the legend is last. */
    const long = { ...info, hints: ['/ search', 't toc', '? keys', 'q quit'] };
    for (let w = 11; w <= 40; w++) {
      const rendered = stripAnsi(statusBar(long, w, theme, 0));
      expect(rendered, `${w} cols: ${JSON.stringify(rendered)}`).toContain('q quit');
      expect(ansiWidth(statusBar(long, w, theme, 3)), `${w} cols`).toBe(w);
    }
  });

  it('I-26 gives up the percentage before the legend, not after it', () => {
    const long = { ...info, hints: ['/ search', 't toc', '? keys', 'q quit'] };
    // Wide enough for both, and the position is there.
    expect(stripAnsi(statusBar(long, 40, theme, 0))).toContain('%');
    // Too narrow for both, and it is the position that goes.
    const narrow = stripAnsi(statusBar(long, 20, theme, 0));
    expect(narrow).toContain('q quit');
    expect(narrow).not.toContain('%');
  });

  it('drops the section before it drops the position', () => {
    const long = { ...info, section: '## A very long section title indeed', hints: ['q quit'] };
    const narrow = stripAnsi(statusBar(long, 34, theme, 0));
    expect(narrow).toContain('22%');
    expect(narrow).not.toContain('A very long section');
  });

  it('I-26 keeps the sideways offset when the hints will not fit', () => {
    /* The offset is what tells a reader whether the `›` at the edge of a row
       is something `l` can reach. The hints are a legend they can get from `?`
       at any time, so the legend is what gives way. */
    const HINTS = ['/ search', 't toc', '? keys', 'q quit'];
    const shifted = { ...info, name: 'wideonly.md', state: '↔ 72', hints: HINTS };
    for (const width of [30, 40, 60, 80, 120]) {
      const bar = stripAnsi(statusBar(shifted, width, theme, 0));
      expect(bar, `${width} cols`).toContain('↔ 72');
      expect(ansiWidth(statusBar(shifted, width, theme, 3)), `${width} cols`).toBe(width);
    }
    /* The legend, not the state, is what gives way when both cannot fit. At 40
       columns the state is intact and the legend has been cut back to its last
       item; only at full width is the whole legend there. */
    const narrow = stripAnsi(statusBar(shifted, 40, theme, 0));
    expect(narrow).toContain('↔ 72');
    expect(narrow).not.toContain('/ search');
    expect(stripAnsi(statusBar(shifted, 120, theme, 0))).toContain('/ search   t toc   ? keys   q quit');
  });

  it('I-26 keeps the mark when even the count will not fit', () => {
    // Narrower still, *that* the viewport is offset outlives by how much.
    const bar = stripAnsi(statusBar({ ...info, name: 'wideonly.md', state: '↔ 72', hints: ['q quit'] }, 25, theme, 0));
    expect(bar).toContain('↔');
  });

  it('I-26 says nothing about a viewport that has not moved sideways', () => {
    const bar = stripAnsi(statusBar({ ...info, state: null }, 80, theme, 0));
    expect(bar).not.toContain('↔');
  });

  it('shows a transient note across the whole bar, never truncated into the filename', () => {
    const note = 'sent 6 lines to the clipboard';
    const bar = stripAnsi(statusBar({ ...info, message: note }, 80, theme, 0));
    expect(bar).toContain(note);
    expect(bar).not.toContain('README.md');
    expect(ansiWidth(statusBar({ ...info, message: note }, 80, theme, 3))).toBe(80);
  });

  it('reports position the way a reader would describe it', () => {
    expect(scrollPercent(0, 20, 200)).toBe(0);
    expect(scrollPercent(180, 20, 200)).toBe(100);
    expect(scrollPercent(90, 20, 200)).toBe(50);
    // A document that fits is entirely on screen, which is 100% read.
    expect(scrollPercent(0, 40, 10)).toBe(100);
  });

  it('names the section the top of the viewport is inside', () => {
    const doc = layoutDoc(fixture('kitchen-sink.md'), opts());
    const title = doc.toc[0]!;
    const tables = doc.toc.find((t) => t.text === 'Tables')!;
    expect(sectionAt(doc, title.line)).toBe('# folio');
    expect(sectionAt(doc, tables.line + 1)).toBe('## Tables');
    // Front matter sits above the first heading, and belongs to no section.
    expect(sectionAt(doc, 0)).toBeNull();
  });
});

describe('search', () => {
  const doc = layoutDoc(fixture('kitchen-sink.md'), opts({ level: 0 }));

  it('is case-insensitive until the query contains a capital', () => {
    expect(isCaseSensitive('pure')).toBe(false);
    expect(isCaseSensitive('Pure')).toBe(true);
    expect(findMatches(doc.lines, 'LAYOUT')).toHaveLength(0);
    expect(findMatches(doc.lines, 'layout').length).toBeGreaterThan(0);
  });

  it('finds every occurrence on a row, not just the first', () => {
    const line = { ansi: 'aa aa aa', plain: 'aa aa aa', block: 0 };
    expect(findMatches([line], 'aa')).toHaveLength(3);
  });

  it('wraps around at both ends', () => {
    const matches = findMatches(doc.lines, 'the');
    expect(nextMatch(matches, Number.MAX_SAFE_INTEGER, false)).toBe(0);
    expect(nextMatch(matches, -1, true)).toBe(matches.length - 1);
    expect(nextMatch([], 0, false)).toBe(-1);
  });

  it('I-28 reaches every match exactly once per cycle', () => {
    /* A row offset cannot address a match: a line may hold several, and
       revealing one scrolls the offset above it. Stepping by offset therefore
       oscillated between two hits while the bar advertised four. */
    const many = layoutDoc('# D\n\nalpha alpha alpha on one line\n\nbeta\n\nalpha again\n', opts());
    const matches = findMatches(many.lines, 'alpha');
    expect(matches.length).toBe(4);

    const visited: number[] = [];
    let at = nextMatch(matches, 0, false);
    for (let i = 0; i < matches.length; i++) {
      visited.push(at);
      at = stepMatch(matches, at, false);
    }
    // Each match once, and back where it started.
    expect(new Set(visited).size).toBe(matches.length);
    expect(at).toBe(visited[0]);
  });

  it('I-28 steps backwards through every match too', () => {
    const many = layoutDoc('# D\n\nalpha alpha alpha\n\nalpha\n', opts());
    const matches = findMatches(many.lines, 'alpha');
    const visited: number[] = [];
    let at = 0;
    for (let i = 0; i < matches.length; i++) {
      visited.push(at);
      at = stepMatch(matches, at, true);
    }
    expect(new Set(visited).size).toBe(matches.length);
    expect(at).toBe(0);
  });

  it('I-28 survives a stale index after the document changes', () => {
    const matches = findMatches(layoutDoc('a\n', opts()).lines, 'a');
    expect(stepMatch(matches, 99, false)).toBe(0);
    expect(stepMatch(matches, -1, true)).toBe(matches.length - 1);
    expect(stepMatch([], 0, false)).toBe(-1);
  });

  it('re-styles a match inside an already-styled row without changing its width', () => {
    const source = layoutDoc('This has **bold pure** text in it.\n', opts({ level: 3 }));
    const row = source.lines[0]!;
    const ranges = findMatches([row], 'pure').map((m) => ({
      start: m.start, end: m.end, style: theme.matchCurrent,
    }));
    const out = highlightRow(row.ansi, row.plain, ranges, 100, 3);
    expect(stripAnsi(out)).toBe(row.plain);
    expect(ansiWidth(out)).toBe(ansiWidth(row.ansi));
    expect(out).toContain('48;2;255;158;100'); // the current-match background
  });

  it('I-11 marks a match without colour, so NO_COLOR still shows where it is', () => {
    /* `paint` returns text untouched at level 0, which is right for everything
       the layout draws — a heading keeps its rule, a task its box. A match has
       no such second channel: it differs from its surroundings by background
       alone, so with colour off it vanished and the match count in the status
       bar was the only evidence it existed. Colour as the only signal is what
       pillar 2 forbids. Reverse video is an attribute, not a colour. */
    const source = layoutDoc('the cat sat on the mat\n', opts({ level: 0 }));
    const row = source.lines[0]!;
    const at = (style: typeof theme.match) =>
      highlightRow(row.ansi, row.plain, findMatches([row], 'cat').map((m) => ({ start: m.start, end: m.end, style })), 100, 0);

    const plain = at(theme.match);
    expect(plain).not.toBe(row.ansi); // it is marked at all
    expect(plain).toContain('\x1b[7m'); // reverse video, not a colour
    expect(plain).not.toMatch(/\x1b\[[34]8;2;/); // and no fg/bg colour
    expect(stripAnsi(plain)).toBe(row.plain); // the text is untouched
    expect(ansiWidth(plain)).toBe(ansiWidth(row.ansi)); // and so is the width

    // The current match stays distinguishable from the rest without colour.
    expect(at(theme.matchCurrent)).not.toBe(plain);
  });

  it('leaves a row alone when nothing matches it', () => {
    const row = doc.lines[0]!;
    expect(highlightRow(row.ansi, row.plain, [], 100, 3)).toBe(row.ansi);
  });
});

describe('overlays', () => {
  const doc = layoutDoc(fixture('kitchen-sink.md'), opts());
  const base = composeFrame(doc, { offset: 0, height: 24, total: doc.lines.length }, 100, theme, 3);

  it('keeps every row exactly the frame width', () => {
    const pane = tocPane(doc, 3, 100, 24, theme, 3);
    const at = centre(pane.width, pane.height, 100, 24);
    const out = overlayRows(base, pane.rows, at.top, at.left, 100, 3);
    expect(out).toHaveLength(base.length);
    expect(new Set(out.map(ansiWidth))).toEqual(new Set([100]));
  });

  it('shows the pane contents over the document', () => {
    const pane = helpPane(100, 24, theme, 3);
    const out = overlayRows(base, pane.rows, 2, 10, 100, 3);
    expect(stripAnsi(out.join('\n'))).toContain('half a screen');
  });

  it('stays on screen in a small terminal', () => {
    for (const [w, h] of [[40, 10], [24, 6], [200, 60]] as const) {
      const pane = tocPane(doc, 0, w, h, theme, 3);
      const at = centre(pane.width, pane.height, w, h);
      expect(at.left + pane.width).toBeLessThanOrEqual(w);
      const frame = composeFrame(doc, { offset: 0, height: h, total: doc.lines.length }, w, theme, 3);
      const out = overlayRows(frame, pane.rows, at.top, at.left, w, 3);
      expect(new Set(out.map(ansiWidth))).toEqual(new Set([w]));
    }
  });

  it('I-25 draws either pane at any terminal size without throwing', () => {
    // A pane is sized from the terminal, and a terminal can be one column
    // wide. `String.repeat` throws on a negative count, which is how a narrow
    // window used to take the whole app down on `?`.
    for (const w of [1, 2, 3, 5, 8, 10, 15, 20, 25, 40, 60, 80, 100, 160, 200]) {
      for (const h of [1, 2, 3, 5, 10, 24, 40]) {
        for (const pane of [tocPane(doc, 0, w, h, theme, 3), helpPane(w, h, theme, 3)]) {
          // Every row of a pane is the same width, or the box shears.
          expect(new Set(pane.rows.map(ansiWidth)), `pane rows at ${w}x${h}`).toEqual(
            new Set([pane.width]),
          );
          const at = centre(pane.width, pane.height, w, h);
          const frame = composeFrame(doc, { offset: 0, height: h, total: doc.lines.length }, w, theme, 3);
          const out = overlayRows(frame, pane.rows, at.top, at.left, w, 3);
          // I-18 holds with an overlay up: the frame is still exactly the width.
          expect(new Set(out.map(ansiWidth)), `frame at ${w}x${h}`).toEqual(new Set([w]));
          expect(out).toHaveLength(h);
        }
      }
    }
  });

  it('I-25 keeps help entries inside the box rather than through it', () => {
    // `padAnsi` pads a short row but leaves a long one alone, so an entry wider
    // than the box used to print straight over the document and the scrollbar.
    for (const w of [25, 30, 40, 41, 44, 60, 100]) {
      const pane = helpPane(w, 24, theme, 3);
      for (const row of pane.rows) {
        const plain = stripAnsi(row);
        // Trailing margin aside, a body row must close with its own border.
        if (plain.includes('│')) expect(plain.trimEnd().endsWith('│'), `${w}: ${plain}`).toBe(true);
      }
    }
  });

  it('I-25 never ends the key list without saying it was cut', () => {
    // A reader who cannot see `q` needs to know the list continues.
    const short = helpPane(80, 8, theme, 0);
    expect(stripAnsi(short.rows.join('\n'))).toContain('folio --help');
    expect(short.height).toBeLessThanOrEqual(8);
  });

  it('I-25 always shows the way out, however short the terminal', () => {
    /* Everything else in the list is a convenience. `q` is the way out of a
       full-screen app, so it is the one entry that survives any clipping. */
    for (const h of [3, 4, 5, 6, 8, 12, 16, 20, 22, 23, 24, 40]) {
      const pane = helpPane(80, h, theme, 0);
      expect(stripAnsi(pane.rows.join('\n')), `${h} rows`).toContain('quit');
      // A box costs a head and a foot; below that it cannot be drawn at all.
      expect(pane.height, `${h} rows`).toBeLessThanOrEqual(Math.max(3, h));
    }
  });

  it('I-25 lists every key the viewer answers to', () => {
    // The overlay is the only place most readers will look; a key that is not
    // here may as well not exist.
    const text = stripAnsi(helpPane(100, 40, theme, 0).rows.join('\n'));
    for (const key of ['tab', 'enter', 'backspace', 'y', '0', 'h  l']) {
      expect(text, `missing ${key}`).toContain(key);
    }
  });

  it('says so when a document has no headings', () => {
    const plain = layoutDoc('just a paragraph\n', opts());
    const pane = tocPane(plain, 0, 100, 24, theme, 0);
    expect(pane.rows.join('\n')).toContain('no headings');
  });
});

const mustParse = (argv: string[]) => {
  const r = parseArgs(argv);
  if (!r.ok) throw new Error(`expected ${argv.join(' ')} to parse: ${r.message}`);
  return r.options;
};

describe('option parsing', () => {
  it('defaults to a paged, 88-column, auto-themed read', () => {
    const r = parseArgs(['README.md']);
    expect(r.ok && r.options).toMatchObject({
      file: 'README.md', maxWidth: 88, theme: 'auto', pager: true, links: 'osc8',
    });
  });

  it('accepts both --flag value and --flag=value', () => {
    expect(mustParse(['--width', '60']).maxWidth).toBe(60);
    expect(mustParse(['--width=60']).maxWidth).toBe(60);
    expect(mustParse(['--theme=light']).theme).toBe('light');
    expect(mustParse(['--links=ref']).links).toBe('ref');
  });

  it('explains what a bad value should have been', () => {
    const r = parseArgs(['--width', '3']);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('at least 20');
    expect(!r.ok && r.code).toBe(2);
  });

  it('rejects an unknown option and a second file', () => {
    expect(parseArgs(['--nope']).ok).toBe(false);
    expect(parseArgs(['a.md', 'b.md']).ok).toBe(false);
  });

  it('treats 0 as fill the terminal', () => {
    expect(mustParse(['--width', '0']).maxWidth).toBe(0);
  });

  it('reads a document from stdin when given - or nothing', () => {
    expect(mustParse(['-']).file).toBeNull();
    expect(mustParse([]).file).toBeNull();
  });
});

describe('I-4 scrolling never re-runs layout', () => {
  it('I-4 composing a frame is orders of magnitude cheaper than laying the document out', () => {
    const src = fixture('large.md');
    const t0 = process.hrtime.bigint();
    const doc = layoutDoc(src, opts({ width: 100 }));
    const layoutMs = Number(process.hrtime.bigint() - t0) / 1e6;

    const t1 = process.hrtime.bigint();
    for (let i = 0; i < 100; i++) {
      composeFrame(doc, { offset: i, height: 40, total: doc.lines.length }, 100, theme, 3);
    }
    const composeMs = Number(process.hrtime.bigint() - t1) / 1e6 / 100;

    // If a scroll re-laid the document out, these would be the same number.
    expect(composeMs * 20).toBeLessThan(layoutMs);
  });
});

describe('I-5 the offset is always in range', () => {
  it('I-5 clamps past either end', () => {
    expect(clampOffset(-10, 100, 20)).toBe(0);
    expect(clampOffset(999, 100, 20)).toBe(80);
    expect(clampOffset(50, 100, 20)).toBe(50);
  });

  it('I-5 treats a document shorter than the viewport as one screenful', () => {
    expect(maxOffset(5, 40)).toBe(0);
    expect(clampOffset(3, 5, 40)).toBe(0);
  });

  it('I-5 handles an empty document', () => {
    expect(clampOffset(0, 0, 24)).toBe(0);
    expect(maxOffset(0, 24)).toBe(0);
  });
});

describe('I-6 a resize keeps the reader in place', () => {
  it('I-6 lands on the same block after a re-layout at a different width', () => {
    const src = fixture('kitchen-sink.md');
    const wide = layoutDoc(src, opts({ width: 160 }));
    const narrow = layoutDoc(src, opts({ width: 60 }));

    const offset = Math.floor(wide.lines.length / 2);
    const block = wide.lines[offset]!.block;
    const moved = anchorOffset(narrow.lines, block, 24);

    expect(narrow.lines[moved]!.block).toBeGreaterThanOrEqual(block);
    // The same content, not the top of the document.
    expect(moved).toBeGreaterThan(0);
    expect(narrow.lines[moved]!.block).toBe(block);
  });

  it('I-6 clamps to the end when the document got shorter', () => {
    const doc = layoutDoc('# a\n\nb\n', opts());
    expect(anchorOffset(doc.lines, 9999, 24)).toBe(0);
  });
});

describe('I-15 key repeat arrives in bursts', () => {
  it('I-15 reads a run of one character as that many keystrokes', () => {
    expect(parseBurst('jjjj', {})).toEqual({ key: 'j', repeat: 4 });
    expect(parseBurst('j', {})).toEqual({ key: 'j', repeat: 1 });
  });

  it('I-15 leaves mixed input alone, because mode may change between characters', () => {
    expect(parseBurst('tq', {})).toEqual({ key: 'tq', repeat: 1 });
  });

  it('I-15 never splits a modified key', () => {
    expect(parseBurst('dd', { ctrl: true })).toEqual({ key: 'dd', repeat: 1 });
    expect(parseBurst('dd', { meta: true })).toEqual({ key: 'dd', repeat: 1 });
  });

  it('I-15 handles an empty chunk', () => {
    expect(parseBurst('', {})).toEqual({ key: '', repeat: 1 });
  });

  it('I-15 applies a burst of different motion keys instead of dropping it', () => {
    /* `jd` used to match no case at all and be discarded, losing both
       keystrokes — the opposite of keeping up with the keyboard. */
    expect(splitBurst('jd', {})).toEqual([
      { key: 'j', repeat: 1 },
      { key: 'd', repeat: 1 },
    ]);
    expect(splitBurst('jjkj', {})).toEqual([
      { key: 'j', repeat: 2 },
      { key: 'k', repeat: 1 },
      { key: 'j', repeat: 1 },
    ]);
  });

  it('I-15 counts variety in runs, not in characters', () => {
    /* The paste guard is about *variety*: I-35 says "more than eight different
       keys". Testing the chunk's length instead made length stand in for it, so
       two keys held in turn tripped a paste guard and every keystroke in the
       chunk was dropped — the opposite of the exemption directly above it,
       which says a run of one key stays typing however long it is. */
    expect(splitBurst('jjjjjkkkkk', {})).toEqual([
      { key: 'j', repeat: 5 },
      { key: 'k', repeat: 5 },
    ]);
    expect(splitBurst(`${'j'.repeat(22)}k`, {})).toEqual([
      { key: 'j', repeat: 22 },
      { key: 'k', repeat: 1 },
    ]);
    // Nine distinct runs is still refused, which is what the guard is for.
    expect(splitBurst('abcdefghi', {})).toEqual([{ key: 'abcdefghi', repeat: 1 }]);
  });

  it('I-15 splits a burst that changes mode part way through', () => {
    /* This used to be refused, because the handler branched on React state and
       `t` would have opened the contents against a mode the `q` after it could
       not see. The handler branches on refs now, so a chunk means the
       keystrokes it spells — `tq` opens the contents and quits, exactly as
       pressing the two keys does. See I-34. */
    expect(splitBurst('tq', {})).toEqual([
      { key: 't', repeat: 1 },
      { key: 'q', repeat: 1 },
    ]);
    expect(splitBurst('j/', {})).toEqual([
      { key: 'j', repeat: 1 },
      { key: '/', repeat: 1 },
    ]);
  });

  it('I-15 does not take a pasted sentence for typing', () => {
    /* Bracketed paste routes a real paste off this channel entirely, but a
       terminal too old for it delivers one as plain text — and replaying a
       sentence as commands means the `q` in "quick" quits the viewer. A run of
       one key is still key repeat, however long. See I-35. */
    for (const pasted of [
      'the quick brown fox jumps over the lazy dog',
      'npm install --save-dev typescript',
      'git commit -m fix',
    ]) {
      expect(splitBurst(pasted, {}), pasted).toEqual([{ key: pasted, repeat: 1 }]);
    }
    // Held keys are unaffected, whatever the length.
    expect(splitBurst('j'.repeat(40), {})).toEqual([{ key: 'j', repeat: 40 }]);
    // And a short burst is still the keystrokes it spells.
    expect(splitBurst('tjjjj\r', {})).toHaveLength(3);
  });

  it('I-15 never splits an escape sequence into its bytes', () => {
    // An arrow key is one keypress spelled in several bytes; splitting it
    // would dispatch `[` and `A` as if the reader had typed them.
    const ESC = String.fromCharCode(27);
    expect(splitBurst(`${ESC}[A`, {})).toEqual([{ key: `${ESC}[A`, repeat: 1 }]);
    expect(splitBurst(`j${ESC}[B`, {})).toEqual([{ key: `j${ESC}[B`, repeat: 1 }]);
  });

  it('I-15 agrees with parseBurst on everything it does not split', () => {
    for (const chunk of ['j', 'jjjj', '', 'tq', 'G', ' ']) {
      const segments = splitBurst(chunk, {});
      if (segments.length === 1) expect(segments[0]).toEqual(parseBurst(chunk, {}));
    }
    expect(splitBurst('jd', { ctrl: true })).toEqual([{ key: 'jd', repeat: 1 }]);
    expect(splitBurst('jd', { meta: true })).toEqual([{ key: 'jd', repeat: 1 }]);
  });
})

/** A document of `depth` nested list items, one level deeper per line. */
const nest = (depth: number) =>
  Array.from({ length: depth }, (_, i) => ' '.repeat(i) + `- item${i}`).join('\n');

describe('formats this viewer does not parse', () => {
  it('shows an org file verbatim rather than misreading it as markdown', () => {
    const src = fixture('sample.org');
    const doc = layoutText(src, opts({ level: 0, width: 100 }));
    const text = doc.lines.map((l) => l.plain).join('\n');
    // Org markup survives exactly as written; markdown would have eaten it.
    expect(text).toContain('#+TITLE: An Org file');
    expect(text).toContain('* A top-level heading');
    expect(text).toContain('#+BEGIN_SRC python');
    expect(text).toContain('[[https://example.com][A link in org syntax]]');
    expect(doc.toc).toEqual([]);
  });

  it('preserves the author’s own blank lines and indentation', () => {
    // width 40 with no cap puts the text column two cells in, so the margin is
    // easy to read off the expectation.
    const doc = layoutText('one\n\n\n    indented\n', opts({ level: 0, width: 40, maxWidth: 0 }));
    const plain = doc.lines.map((l) => l.plain);
    expect(plain).toEqual(['  one', '', '', '      indented']);
  });

  it('I-1 never overflows the terminal, at any width', () => {
    const src = fixture('sample.org');
    for (const width of [40, 80, 100, 200]) {
      const doc = layoutText(src, opts({ width, level: 3 }));
      for (const line of doc.lines) expect(ansiWidth(line.ansi)).toBeLessThanOrEqual(width);
    }
  });

  it('routes by extension, defaulting to markdown', () => {
    expect(isMarkdownPath('notes.md')).toBe(true);
    expect(isMarkdownPath('README')).toBe(true);
    expect(isMarkdownPath(null)).toBe(true);
    expect(isMarkdownPath('notes.org')).toBe(false);
    expect(isMarkdownPath('SERVER.LOG')).toBe(false);
    expect(isMarkdownPath('notes.txt')).toBe(false);
  });

  /* Only the prose formats were ever routed away from the parser. Everything
     else — source, config, data — went through it, and markdown does not merely
     style those wrongly, it destroys them: a paragraph is a run of non-blank
     lines joined with spaces, so a Python file arrived as a single line with
     every indent gone, `# comment` became a heading and `* item` a bullet.
     Indentation *is* the file for most of this list. See I-38. */
  describe('I-38 formats whose layout is their meaning are not parsed as markdown', () => {
    it('I-38 routes source, config and data away from the parser', () => {
      for (const path of [
        'app.py', 'main.go', 'index.ts', 'server.js', 'style.css', 'Cargo.toml',
        'package.json', 'compose.yaml', 'query.sql', 'run.sh', 'data.csv',
        'fix.patch', 'page.html', 'src/deep/module.rb',
      ]) {
        expect(isMarkdownPath(path), path).toBe(false);
      }
    });

    it('I-38 treats dotfiles and build files as configuration', () => {
      for (const path of [
        '.gitignore', '.zshrc', '.env', '.env.local', '.eslintrc.json',
        'Makefile', 'Dockerfile', 'a/b/Gemfile',
      ]) {
        expect(isMarkdownPath(path), path).toBe(false);
      }
    });

    it('I-38 keeps a hidden markdown file markdown', () => {
      // A leading dot hides a file; it does not change what the file is.
      for (const path of ['.notes.md', '.github/README.md', 'docs/.draft.markdown']) {
        expect(isMarkdownPath(path), path).toBe(true);
      }
    });

    it('I-38 reads the extension from the basename, not the path', () => {
      // A dot in a *directory* name is not the file's extension.
      expect(isMarkdownPath('/etc/nginx.d/README')).toBe(true);
      expect(isMarkdownPath('/etc/nginx.d/notes.py')).toBe(false);
    });

    it('I-38 still defaults an unknown or absent extension to markdown', () => {
      for (const path of ['README', 'CHANGELOG', 'notes.mdx', 'weird.zzz', 'docs/guide.md']) {
        expect(isMarkdownPath(path), path).toBe(true);
      }
    });

    it('I-40 refuses to parse nesting deep enough to be an attack', () => {
      /* `marked` is O(depth²) here: 1,600 levels take the best part of a
         second and 5,000 abort the process outright, which no `try`/`catch`
         can see because the parse is one synchronous call. */
      expect(nestsTooDeeply(nest(5000))).toBe(true);
      // Far above anything a person writes, so ordinary documents are untouched.
      expect(nestsTooDeeply(nest(40))).toBe(false);
      expect(nestsTooDeeply(fixture('kitchen-sink.md'))).toBe(false);
      expect(nestsTooDeeply('')).toBe(false);
      // Ordered lists nest the same way, and are bounded the same way.
      const ordered = Array.from({ length: 400 }, (_, i) => ' '.repeat(i) + `${i + 1}. item`).join('\n');
      expect(nestsTooDeeply(ordered)).toBe(true);
      /* Indentation on its own is not the trigger — only a line that *opens a
         list item* can nest, so an indented paragraph is left alone. */
      expect(nestsTooDeeply(' '.repeat(400) + 'just some deeply indented prose')).toBe(false);
    });

    it('I-40 lays the pathological document out in bounded time', () => {
      const src = nest(5000);
      // Verbatim, which is what the guard falls back to, and which loses no text.
      const started = Date.now();
      const doc = layoutText(src, opts({ level: 0, width: 80 }));
      /* Deliberately loose. What this forbids is the unbounded case — the
         parse that takes the best part of a second at 1,600 levels and aborts
         the process outright at 5,000 — and that failure is orders of
         magnitude, not a factor of two. The budget only has to be under it.
         Set tight, it measured the runner instead of the code: this takes
         ~680 ms on a developer's machine and a shared CI box is routinely
         two to three times slower, so a 2,000 ms bar failed a release for a
         reason that had nothing to do with what changed. */
      expect(Date.now() - started).toBeLessThan(5000);
      expect(doc.lines.length).toBeGreaterThan(0);
      expect(doc.lines.some((l) => l.plain.includes('item4999'))).toBe(true);
    });

    it('I-39 tells a document from a file of bytes', () => {
      /* A PNG used to render as screens of caret notation: safe, because
         control bytes are neutralised on the way in (I-29), and useless. The
         NUL is what separates them — every binary header has one and no UTF-8
         text does. */
      expect(looksBinary('\u0089PNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR')).toBe(true);
      expect(looksBinary('# A perfectly ordinary document\n\nwith prose.\n')).toBe(false);
      // Emoji, CJK and an escape the sanitiser will render as `^[` are all text.
      expect(looksBinary('# 标题 ⚠️\n\n\u001b[2J is content, not a command.\n')).toBe(false);
      expect(looksBinary('')).toBe(false);
      /* Bounded, so a huge document is not read twice: a NUL past the sniff
         window is not found, which is the deliberate trade — the answer is
         always in the header. */
      expect(looksBinary('a'.repeat(9000) + '\u0000')).toBe(false);
    });

    it('I-38 keeps every indent and line break of a source file', () => {
      const src = '# a comment\ndef load(path):\n    with open(path) as f:\n        return f.read()\n';
      const doc = layoutText(src, opts({ level: 0, width: 60, maxWidth: 0 }));
      const plain = doc.lines.map((l) => l.plain);
      expect(plain).toEqual([
        '  # a comment',
        '  def load(path):',
        '      with open(path) as f:',
        '          return f.read()',
      ]);
    });
  });

  it('I-17 takes everything after -- as a filename', () => {
    /* The convention every other tool follows, and the only way to name a file
       that begins with a dash: without it there was no spelling that worked. */
    const dashed = parseArgs(['--', '-w']);
    expect(dashed.ok && dashed.options.file).toBe('-w');
    const plain = parseArgs(['--', 'README.md']);
    expect(plain.ok && plain.options.file).toBe('README.md');
    // Options before it are still options.
    const both = parseArgs(['--plain', '--', '--help']);
    expect(both.ok && both.options.plain).toBe(true);
    expect(both.ok && both.options.file).toBe('--help');
    expect(both.ok && both.options.help).toBe(false);
    // And one file is still the limit.
    const two = parseArgs(['--', 'a.md', 'b.md']);
    expect(two.ok).toBe(false);
  });

  it('takes an explicit override from the command line', () => {
    const r = parseArgs(['--text', 'x.md']);
    expect(r.ok && r.options.markdown).toBe(false);
    const m = parseArgs(['--markdown', 'x.org']);
    expect(m.ok && m.options.markdown).toBe(true);
    const d = parseArgs(['x.md']);
    expect(d.ok && d.options.markdown).toBeNull();
  });
});
