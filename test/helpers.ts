import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ColorLevel } from '../src/core/ansi.js';
import type { LayoutOptions } from '../src/core/types.js';
import { pickTheme } from '../src/ui/theme.js';

const DIR = join(import.meta.dirname, 'fixtures');

export const FIXTURES = readdirSync(DIR)
  .filter((f) => f.endsWith('.md'))
  .sort();

export function fixture(name: string): string {
  return readFileSync(join(DIR, name), 'utf8');
}

export function opts(over: Partial<LayoutOptions> = {}): LayoutOptions {
  return {
    width: 100,
    maxWidth: 88,
    theme: pickTheme('dark'),
    level: 3 as ColorLevel,
    lineNumbers: false,
    links: 'osc8',
    overflow: 'wrap',
    ...over,
  };
}
