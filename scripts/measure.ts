#!/usr/bin/env tsx
/** Where the time actually goes: laying a document out, versus drawing a frame of it. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { layoutDoc } from '../src/md/layout.js';
import { collectLanguages, createHighlighter } from '../src/md/highlight.js';
import { composeFrame } from '../src/ui/chrome.js';
import { pickTheme } from '../src/ui/theme.js';

const ROOT = join(import.meta.dirname, '..');
const theme = pickTheme('dark');

/** Min-of-N, not median: wall-clock inflates under load, and the minimum is
 *  the least-contended sample while still being an upper bound. */
function best(runs: number, fn: () => void): number {
  let min = Infinity;
  for (let i = 0; i < runs; i++) {
    const t0 = process.hrtime.bigint();
    fn();
    min = Math.min(min, Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return min;
}

for (const name of ['kitchen-sink.md', 'large.md']) {
  const src = readFileSync(join(ROOT, 'test/fixtures', name), 'utf8');
  const langs = collectLanguages(src);
  const t0 = Date.now();
  const hl = await createHighlighter(theme.shiki, langs);
  const hlMs = Date.now() - t0;

  const options = {
    width: 99, maxWidth: 88, theme, level: 3 as const,
    lineNumbers: false, links: 'osc8' as const, overflow: 'wrap' as const, highlight: hl?.fn,
  };
  const doc = layoutDoc(src, options);
  const layoutMs = best(5, () => layoutDoc(src, options));
  const frameMs = best(5, () => {
    for (let i = 0; i < 100; i++) {
      composeFrame(doc, { offset: i, height: 40, total: doc.lines.length }, 100, theme, 3);
    }
  }) / 100;
  hl?.dispose();

  console.log(
    `${name.padEnd(18)} ${String(src.split('\n').length).padStart(6)} src lines  ` +
      `${String(doc.lines.length).padStart(6)} rows  ` +
      `highlighter ${String(hlMs).padStart(4)}ms  ` +
      `layout ${layoutMs.toFixed(1).padStart(6)}ms  ` +
      `frame ${frameMs.toFixed(3)}ms`,
  );
}
