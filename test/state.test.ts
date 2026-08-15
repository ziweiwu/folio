import { describe, expect, it } from 'vitest';
import { EMPTY, MAX_ENTRIES, forget, parsePositions, recall, remember } from '../src/core/positions.js';
import { MAX_BYTES, osc52 } from '../src/core/clipboard.js';
import { layoutDoc } from '../src/md/layout.js';
import { anchorOffset } from '../src/core/position.js';
import { fixture, opts } from './helpers.js';

describe('remembering where you were', () => {
  it('stores a block and reads it back', () => {
    const store = remember(EMPTY, '/a/b.md', 42, 1000);
    expect(recall(store, '/a/b.md')).toBe(42);
    expect(recall(store, '/never/read.md')).toBeNull();
  });

  it('survives a round trip through JSON', () => {
    const store = remember(remember(EMPTY, '/a.md', 3, 1), '/b.md', 9, 2);
    expect(parsePositions(JSON.stringify(store))).toEqual(store);
  });

  it('I-22 treats a corrupt or foreign store as empty rather than failing', () => {
    expect(parsePositions('not json')).toEqual(EMPTY);
    expect(parsePositions('null')).toEqual(EMPTY);
    expect(parsePositions('{"version":99,"entries":{}}')).toEqual(EMPTY);
    expect(parsePositions('{"version":1,"entries":{"/a":{"block":"nope"}}}')).toEqual(EMPTY);
  });

  it('drops the least recently read entries past the cap', () => {
    let store = EMPTY;
    for (let i = 0; i < MAX_ENTRIES + 50; i++) store = remember(store, `/file-${i}.md`, i, i);
    expect(Object.keys(store.entries)).toHaveLength(MAX_ENTRIES);
    expect(recall(store, '/file-0.md')).toBeNull();
    expect(recall(store, `/file-${MAX_ENTRIES + 49}.md`)).toBe(MAX_ENTRIES + 49);
  });

  it('refreshes an entry rather than duplicating it', () => {
    const store = remember(remember(EMPTY, '/a.md', 1, 1), '/a.md', 7, 2);
    expect(Object.keys(store.entries)).toHaveLength(1);
    expect(recall(store, '/a.md')).toBe(7);
  });

  it('forgets a file on request', () => {
    expect(recall(forget(remember(EMPTY, '/a.md', 1, 1), '/a.md'), '/a.md')).toBeNull();
  });

  it('I-21 a block survives being reopened at a different width, which a row would not', () => {
    const src = fixture('kitchen-sink.md');
    const wide = layoutDoc(src, opts({ width: 160 }));
    const narrow = layoutDoc(src, opts({ width: 60 }));
    const row = Math.floor(wide.lines.length / 2);
    const block = wide.lines[row]!.block;

    const store = remember(EMPTY, '/k.md', block, 1);
    const back = anchorOffset(narrow.lines, recall(store, '/k.md')!, 24);
    expect(narrow.lines[back]!.block).toBe(block);
    // The row index alone would have pointed somewhere else entirely.
    expect(back).not.toBe(row);
  });
});

describe('copying over OSC 52', () => {
  it('wraps base64 in the clipboard escape', () => {
    const r = osc52('hello');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.sequence).toBe(`\x1b]52;c;${Buffer.from('hello').toString('base64')}\x07`);
    expect(r.bytes).toBe(5);
  });

  it('counts bytes, not characters', () => {
    const r = osc52('你好');
    expect(r.ok && r.bytes).toBe(6);
  });

  it('refuses an empty copy and an oversized one, with a reason', () => {
    expect(osc52('')).toEqual({ ok: false, reason: 'nothing to copy' });
    const huge = osc52('x'.repeat(MAX_BYTES));
    expect(huge.ok).toBe(false);
    expect(!huge.ok && huge.reason).toContain('too large');
  });

  it('copies a code block verbatim, without the frame around it', () => {
    const doc = layoutDoc('# t\n\n```js\nconst a = 1;\nconst b = 2;\n```\n', opts());
    expect(doc.code).toHaveLength(1);
    expect(doc.code[0]!.code).toBe('const a = 1;\nconst b = 2;');
    expect(doc.code[0]!.lang).toBe('js');
  });

  it('locates each code block against the rows it occupies', () => {
    const doc = layoutDoc(fixture('kitchen-sink.md'), opts({ level: 0 }));
    expect(doc.code.length).toBeGreaterThan(1);
    for (const block of doc.code) {
      expect(block.from).toBeLessThanOrEqual(block.to);
      expect(doc.lines[block.from]!.plain).toContain('╭');
      expect(doc.lines[block.to]!.plain).toContain('╰');
      // The first line of the source appears somewhere inside the frame.
      const inside = doc.lines.slice(block.from, block.to + 1).map((l) => l.plain).join('\n');
      expect(inside).toContain(block.code.split('\n')[0]!.trim());
    }
  });
});
