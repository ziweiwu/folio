import type { Theme } from '../core/types.js';

/**
 * One hue per role, and the accent hue reused across headings, list markers,
 * quote bars and the status bar so the eye can follow structure without
 * reading it. Colour is never the only signal: headings are also bold, quotes
 * also carry a bar, task items also carry a glyph. See I-11.
 */

const dark: Theme = {
  name: 'dark',
  shiki: 'tokyo-night',

  text: { fg: '#c0caf5' },
  muted: { fg: '#9aa5ce' },
  faint: { fg: '#565f89' },

  h1: { fg: '#16161e', bg: '#7aa2f7', bold: true },
  h2: { fg: '#7aa2f7', bold: true },
  h3: { fg: '#bb9af7', bold: true },
  h4: { fg: '#7dcfff', bold: true },
  headingRule: { fg: '#3b4261' },

  strong: { fg: '#e6eaff', bold: true },
  em: { fg: '#c0caf5', italic: true },
  strike: { fg: '#565f89', strike: true },

  link: { fg: '#7dcfff', underline: true },
  linkUrl: { fg: '#565f89' },

  codeBg: '#1c1f2e',
  codeText: { fg: '#a9b1d6', bg: '#1c1f2e' },
  codeLabel: { fg: '#565f89', bg: '#1c1f2e', italic: true },
  codeGutter: { fg: '#3b4261', bg: '#1c1f2e' },
  inlineCode: { fg: '#ff9e64', bg: '#24283b' },

  quoteBar: { fg: '#7aa2f7' },
  quoteText: { fg: '#9aa5ce', italic: true },

  listMarker: { fg: '#7aa2f7' },
  taskDone: { fg: '#9ece6a' },
  taskTodo: { fg: '#565f89' },

  tableBorder: { fg: '#3b4261' },
  tableHeader: { fg: '#7aa2f7', bold: true },

  rule: { fg: '#3b4261' },
  image: { fg: '#bb9af7' },
  frontMatterKey: { fg: '#7aa2f7' },
  frontMatterValue: { fg: '#9aa5ce' },

  status: { fg: '#a9b1d6', bg: '#24283b' },
  statusAccent: { fg: '#7aa2f7', bg: '#24283b', bold: true },
  statusMuted: { fg: '#565f89', bg: '#24283b' },

  scrollTrack: { fg: '#292e42' },
  scrollThumb: { fg: '#7aa2f7' },

  match: { fg: '#1a1b26', bg: '#e0af68' },
  matchCurrent: { fg: '#1a1b26', bg: '#ff9e64', bold: true },

  overlayBg: '#1f2335',
  overlayText: { fg: '#c0caf5', bg: '#1f2335' },
  overlayTitle: { fg: '#7aa2f7', bg: '#1f2335', bold: true },
};

const light: Theme = {
  name: 'light',
  shiki: 'github-light',

  text: { fg: '#24292f' },
  muted: { fg: '#57606a' },
  faint: { fg: '#8c959f' },

  h1: { fg: '#ffffff', bg: '#0969da', bold: true },
  h2: { fg: '#0969da', bold: true },
  h3: { fg: '#8250df', bold: true },
  h4: { fg: '#1f6feb', bold: true },
  headingRule: { fg: '#d0d7de' },

  strong: { fg: '#0d1117', bold: true },
  em: { fg: '#24292f', italic: true },
  strike: { fg: '#8c959f', strike: true },

  link: { fg: '#0969da', underline: true },
  linkUrl: { fg: '#8c959f' },

  codeBg: '#f3f5f8',
  codeText: { fg: '#24292f', bg: '#f3f5f8' },
  codeLabel: { fg: '#8c959f', bg: '#f3f5f8', italic: true },
  codeGutter: { fg: '#c3ccd6', bg: '#f3f5f8' },
  inlineCode: { fg: '#cf222e', bg: '#eff1f3' },

  quoteBar: { fg: '#0969da' },
  quoteText: { fg: '#57606a', italic: true },

  listMarker: { fg: '#0969da' },
  taskDone: { fg: '#1a7f37' },
  taskTodo: { fg: '#8c959f' },

  tableBorder: { fg: '#d0d7de' },
  tableHeader: { fg: '#0969da', bold: true },

  rule: { fg: '#d0d7de' },
  image: { fg: '#8250df' },
  frontMatterKey: { fg: '#0969da' },
  frontMatterValue: { fg: '#57606a' },

  status: { fg: '#24292f', bg: '#eaeef2' },
  statusAccent: { fg: '#0969da', bg: '#eaeef2', bold: true },
  statusMuted: { fg: '#8c959f', bg: '#eaeef2' },

  scrollTrack: { fg: '#e4e8ed' },
  scrollThumb: { fg: '#0969da' },

  match: { fg: '#24292f', bg: '#fff8c5' },
  matchCurrent: { fg: '#24292f', bg: '#ffd33d', bold: true },

  overlayBg: '#f6f8fa',
  overlayText: { fg: '#24292f', bg: '#f6f8fa' },
  overlayTitle: { fg: '#0969da', bg: '#f6f8fa', bold: true },
};

export const THEMES: Record<string, Theme> = { dark, light };

/**
 * COLORFGBG is the only widely-supported hint a terminal gives about its
 * background, and plenty of terminals do not set it at all. Dark is the right
 * default for the ones that stay silent — it is by far the more common setup,
 * and a dark theme on a light terminal is merely low-contrast, whereas the
 * reverse is unreadable.
 */
export function pickTheme(name: string, env: NodeJS.ProcessEnv = process.env): Theme {
  if (name === 'dark' || name === 'light') return THEMES[name]!;
  const fgbg = env.COLORFGBG;
  if (fgbg) {
    const bg = Number.parseInt(fgbg.split(';').pop() ?? '', 10);
    if (bg === 7 || bg === 15) return light;
  }
  return dark;
}
