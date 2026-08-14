#!/usr/bin/env tsx
/**
 * Render a document to stdout without any of the TUI.
 *
 * The layout engine is the part worth iterating on, and this is the shortest
 * loop for looking at it: no alt screen, no raw mode, just the rows.
 *
 *   npm run preview -- test/fixtures/kitchen-sink.md 100
 */
import { readFileSync } from 'node:fs';
import { detectColorLevel } from '../src/core/ansi.js';
import { layoutDoc } from '../src/md/layout.js';
import { collectLanguages, createHighlighter } from '../src/md/highlight.js';
import { pickTheme } from '../src/ui/theme.js';

const [file, widthArg, themeArg] = process.argv.slice(2);
if (!file) {
  console.error('usage: preview <file.md> [width] [theme]');
  process.exit(2);
}

const width = Number(widthArg) || process.stdout.columns || 100;
const src = readFileSync(file, 'utf8');
const theme = pickTheme(themeArg ?? 'dark');
const hl = await createHighlighter(theme.shiki, collectLanguages(src));

const doc = layoutDoc(src, {
  width,
  maxWidth: 88,
  theme,
  level: detectColorLevel(),
  lineNumbers: false,
  links: 'osc8',
  overflow: 'wrap',
  highlight: hl?.fn,
});

for (const line of doc.lines) process.stdout.write(line.ansi + '\n');
console.error(`\n${doc.lines.length} rows, ${doc.toc.length} headings, width ${width}`);
