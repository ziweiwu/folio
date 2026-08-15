import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * INVARIANTS.md claims every invariant "has at least one test whose name starts
 * with its number, so the mapping is mechanically checkable". Nothing checked
 * it. Two had quietly drifted uncovered — and `vitest run -t "I-22 "` reports
 * every test skipped and still exits 0, so the suggested check passes loudest
 * exactly when it has found nothing.
 */
const ROOT = join(import.meta.dirname, '..');
const DOC = readFileSync(join(ROOT, 'INVARIANTS.md'), 'utf8');

/** Every invariant the document defines, from the left column of its tables. */
const DEFINED = [...DOC.matchAll(/^\| I-(\d+) \|/gm)].map((m) => Number(m[1])).sort((a, b) => a - b);

const corpus = [
  ...readdirSync(join(ROOT, 'test'))
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
    .map((f) => readFileSync(join(ROOT, 'test', f), 'utf8')),
  ...readdirSync(join(ROOT, 'scripts'))
    .filter((f) => f.endsWith('.sh'))
    .map((f) => readFileSync(join(ROOT, 'scripts', f), 'utf8')),
].join('\n');

describe('the invariant contract is mechanically checkable', () => {
  it('defines invariants at all', () => {
    // Guards the regex above: a parse that silently matched nothing would make
    // every assertion below vacuous.
    expect(DEFINED.length).toBeGreaterThan(30);
  });

  it.each(DEFINED)('I-%i is carried by a test name or a verification script', (n) => {
    /* Followed by a non-digit, or `I-2` would be satisfied by `I-23`. */
    expect(new RegExp(`I-${n}(?![0-9])`).test(corpus), `I-${n} has nothing carrying its number`).toBe(true);
  });
});
