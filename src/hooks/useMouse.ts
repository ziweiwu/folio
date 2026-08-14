import { useEffect } from 'react';

/** Lines a single wheel notch moves. Three matches every other pager. */
export const WHEEL_LINES = 3;

const SGR_MOUSE = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g;

const WHEEL_UP = 64;
const WHEEL_DOWN = 65;

/**
 * Wheel events from SGR mouse reporting.
 *
 * Ink has no mouse support, so this reads the raw stream alongside it. The
 * sequences also reach Ink's own key parser, which is why `useInput` has to
 * ignore anything containing the `\x1b[<` introducer — otherwise a scroll would
 * register as a burst of keystrokes.
 */
export function useMouse(
  stdin: NodeJS.ReadStream | undefined,
  enabled: boolean,
  onWheel: (deltaLines: number) => void,
): void {
  useEffect(() => {
    if (!enabled || !stdin) return;

    const onData = (chunk: Buffer | string) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      if (!text.includes('\x1b[<')) return;
      let delta = 0;
      SGR_MOUSE.lastIndex = 0;
      for (const m of text.matchAll(SGR_MOUSE)) {
        const button = Number(m[1]);
        if (button === WHEEL_UP) delta -= WHEEL_LINES;
        else if (button === WHEEL_DOWN) delta += WHEEL_LINES;
      }
      if (delta !== 0) onWheel(delta);
    };

    stdin.on('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin, enabled, onWheel]);
}

/** True for input that is really a mouse report, which key handling must skip. */
export function isMouseSequence(input: string): boolean {
  return input.includes('\x1b[<') || input.includes('[<');
}
