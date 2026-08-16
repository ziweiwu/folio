#!/usr/bin/env tsx
/**
 * Are docs/*.png current?
 *
 * Compares the digest recorded when the screenshots were last generated against
 * the frames the app draws now. Deterministic and Chrome-free, so it runs on any
 * CI runner -- see framesDigest() in frames.ts for why the PNG bytes cannot be
 * compared instead.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { framesDigest, ROOT } from './frames.js';

const receipt = join(ROOT, 'docs', 'frames.sha256');

/**
 * process.exitCode rather than process.exit: writes to stderr are asynchronous
 * when it is a pipe, which it is under CI, and process.exit does not flush
 * them. Exiting on the spot loses the message saying how to fix the failure.
 */
async function main(): Promise<number> {
  let recorded: string;
  try {
    recorded = readFileSync(receipt, 'utf8').trim();
  } catch {
    console.error(`missing ${receipt} — run \`npm run screenshots\` and commit the result`);
    return 1;
  }

  const current = await framesDigest();
  if (current !== recorded) {
    console.error(
      'docs/*.png are stale: the app no longer draws what the screenshots show.\n' +
        `  recorded ${recorded}\n  current  ${current}\n` +
        'Run `npm run screenshots` and commit docs/.',
    );
    return 1;
  }
  console.error('screenshots are current');
  return 0;
}

process.exitCode = await main();
