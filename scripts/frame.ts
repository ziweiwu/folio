#!/usr/bin/env tsx
/** Print one composed frame, for eyeballing the viewport rather than the layout. */
import { readFileSync } from 'node:fs';
import { detectColorLevel } from '../src/core/ansi.js';
import { layoutDoc } from '../src/md/layout.js';
import { composeFrame } from '../src/ui/chrome.js';
import { pickTheme } from '../src/ui/theme.js';

const [file, colsArg, rowsArg, hArg, overflowArg] = process.argv.slice(2);
const columns = Number(colsArg) || 80;
const height = Number(rowsArg) || 24;
const theme = pickTheme('dark');
const doc = layoutDoc(readFileSync(file!, 'utf8'), {
  width: columns - 1, maxWidth: 88, theme, level: detectColorLevel(),
  lineNumbers: false, links: 'osc8',
  overflow: overflowArg === 'wrap' ? 'wrap' : 'scroll',
});
const rows = composeFrame(doc, { offset: 0, height, total: doc.lines.length, hOffset: Number(hArg) || 0 }, columns, theme, detectColorLevel());
for (const r of rows) process.stdout.write(r + '\n');
