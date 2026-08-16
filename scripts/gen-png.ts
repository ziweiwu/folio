#!/usr/bin/env tsx
/**
 * Screenshots for the README.
 *
 * PNG rather than SVG, deliberately: npm renders the README from
 * raw.githubusercontent, which serves SVG as text/plain, so an SVG screenshot
 * shows as a broken image on the package page. PNG works on both.
 *
 * The frames come from the app's own compose functions, so a screenshot cannot
 * drift from what the viewer draws. Chrome only rasterises them.
 *
 *   FORCE_COLOR=3 npm run screenshots
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ansiToHtml } from './ansi-to-html.js';
import { digestFrames, renderFrame, ROOT, SHOTS } from './frames.js';

/**
 * Any Chrome will do -- it only rasterises, and the receipt CI checks is hashed
 * from the frames, not the pixels. Hardcoding the macOS path left a Linux
 * contributor who changed rendering with a red `verify:screenshots` and no way
 * to regenerate what it was asking for. $CHROME overrides.
 */
const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

const CHROME = process.env.CHROME ?? CHROME_CANDIDATES.find((p) => existsSync(p));
if (!CHROME) {
  console.error(
    'no Chrome found. Install Google Chrome or Chromium, or point $CHROME at one:\n' +
      CHROME_CANDIDATES.map((p) => `  ${p}`).join('\n'),
  );
  process.exit(1);
}

const GROUND = {
  dark: { fg: '#c0caf5', bg: '#1a1b26' },
  light: { fg: '#24292f', bg: '#ffffff' },
};


/** Chrome measures in CSS pixels, so the window has to match the type metrics. */
const FONT_PX = 14;
const CHAR_W = FONT_PX * 0.6;
const LINE_H = Math.round(FONT_PX * 1.45);
const PAD = 18;
const RADIUS = 10;

function page(html: string, ground: { fg: string; bg: string }, cols: number, rows: number): string {
  const w = Math.ceil(cols * CHAR_W) + PAD * 2;
  const h = rows * LINE_H + PAD * 2;
  return `<!doctype html><meta charset="utf-8"><style>
  html, body { margin: 0; padding: 0; background: transparent; }
  .term {
    width: ${w}px; height: ${h}px; box-sizing: border-box;
    background: ${ground.bg}; color: ${ground.fg};
    border-radius: ${RADIUS}px; padding: ${PAD}px;
    font: ${FONT_PX}px/${LINE_H}px "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-ligatures: none; white-space: pre; overflow: hidden;
  }
</style><div class="term">${html}</div>`;
}

const outDir = join(ROOT, 'docs');
mkdirSync(outDir, { recursive: true });
const tmp = join(ROOT, '.screenshot-tmp');
mkdirSync(tmp, { recursive: true });

const drawn: { id: string; rows: string[] }[] = [];

for (const spec of SHOTS) {
  const { rows } = await renderFrame(spec);
  drawn.push({ id: spec.id, rows });
  const html = ansiToHtml(rows, GROUND[spec.theme]);
  const file = join(tmp, `${spec.id}.html`);
  writeFileSync(file, page(html, GROUND[spec.theme], spec.cols, spec.rows));

  const w = Math.ceil(spec.cols * CHAR_W) + PAD * 2;
  const h = spec.rows * LINE_H + PAD * 2;
  execFileSync(
    CHROME,
    [
      '--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
      // Transparent ground, so the rounded corners are not squared off by white.
      '--default-background-color=00000000',
      `--screenshot=${join(outDir, `${spec.id}.png`)}`,
      `--window-size=${w},${h}`,
      '--force-device-scale-factor=2',
      `file://${file}`,
    ],
    { stdio: 'ignore' },
  );
  console.error(`  docs/${spec.id}.png  ${spec.cols}x${spec.rows}`);
}

rmSync(tmp, { recursive: true, force: true });

// The freshness receipt. CI compares this against the frames as they are drawn
// then, which is how a rendering change that forgot the screenshots gets caught.
// Hashed from the frames just rasterised rather than from a second render, so
// the receipt cannot describe frames other than the ones in docs/ -- and the
// six frames are not composed twice per run.
writeFileSync(join(outDir, 'frames.sha256'), `${await digestFrames(drawn)}\n`);

console.error(`\n${SHOTS.length} screenshots written to docs/`);
