import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * INVARIANTS.md claims every invariant "has at least one test whose name starts
 * with its number, so the mapping is mechanically checkable". Nothing checked
 * it. Two had quietly drifted uncovered — and `vitest run -t "I-22 "` reports
 * every test skipped and still exits 0, so the suggested check passes loudest
 * exactly when it has found nothing.
 *
 * The first version of this file searched the whole file text, which is weaker
 * than the claim: an invariant could be satisfied by a comment mentioning its
 * number, and three of them (I-8, I-12, I-24) were. What is searched here is
 * only what a reader can actually run — the titles vitest matches with `-t`,
 * and the labels the shell checks print — so `npx vitest run -t "I-6"` really
 * does select the guard, which is the property the document promises.
 */
const ROOT = join(import.meta.dirname, '..');
const DOC = readFileSync(join(ROOT, 'INVARIANTS.md'), 'utf8');

/** Every invariant the document defines, from the left column of its tables. */
const DEFINED = [...DOC.matchAll(/^\| I-(\d+) \|/gm)].map((m) => Number(m[1])).sort((a, b) => a - b);

/**
 * Titles passed to describe/it/test — exactly what `vitest -t` matches on.
 *
 * The lookbehind matters: without it `submit(`, `latest(` and `unit(` start a
 * match, and the lazy `[\s\S]*?` then runs to the next quote and moves
 * `lastIndex` past whatever real title followed.
 */
function testTitles(source: string): string[] {
  const titles: string[] = [];
  const call = /(?<![\w.])(?:describe|it|test)(?:\.each\((?:[^()]|\([^()]*\))*\))?\s*\(\s*(['"`])([\s\S]*?)\1/g;
  for (const m of source.matchAll(call)) titles.push(m[2] ?? '');
  return titles;
}

/**
 * Quoted labels on non-comment lines — what the scripts print as they run.
 * Both quote styles: `ok`/`bad` take double quotes, the `printf` reports in
 * verify-pty.sh take single ones, and both are output a reader sees.
 */
function scriptLabels(source: string): string[] {
  const labels: string[] = [];
  for (const line of source.split('\n')) {
    if (line.trimStart().startsWith('#')) continue;
    for (const m of line.matchAll(/"([^"]*)"|'([^']*)'/g)) labels.push(m[1] ?? m[2] ?? '');
  }
  return labels;
}

const TITLES = readdirSync(join(ROOT, 'test'))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .flatMap((f) => testTitles(readFileSync(join(ROOT, 'test', f), 'utf8')));

const LABELS = readdirSync(join(ROOT, 'scripts'))
  .filter((f) => f.endsWith('.sh'))
  .flatMap((f) => scriptLabels(readFileSync(join(ROOT, 'scripts', f), 'utf8')));

const carriers = [...TITLES, ...LABELS].join('\n');

describe('the invariant contract is mechanically checkable', () => {
  it('defines invariants at all', () => {
    // Guards the regex above: a parse that silently matched nothing would make
    // every assertion below vacuous.
    expect(DEFINED.length).toBeGreaterThan(30);
  });

  it('finds carriers at all', () => {
    // The same guard for the other side. An extractor that matched nothing
    // would fail every invariant rather than passing them, but it would fail
    // for the wrong reason, and the message would send the reader to the docs
    // instead of to this file.
    //
    // Each extractor is asserted separately on purpose: the labels alone clear
    // any combined floor, so a dead title regex — `it.only(...)`, a title
    // spelling neither extractor knows — would hide behind them.
    expect(TITLES.length).toBeGreaterThan(200);
    expect(LABELS.length).toBeGreaterThan(50);
  });

  it.each(DEFINED)('I-%i is carried by a test name or a verification script', (n) => {
    /* Followed by a non-digit, or `I-2` would be satisfied by `I-23`. */
    expect(
      new RegExp(`I-${n}(?![0-9])`).test(carriers),
      `I-${n} is not named by any test title or script label. A comment mentioning it is not enough: the doc promises \`npx vitest run -t "I-${n}"\` selects its guard.`,
    ).toBe(true);
  });
});
