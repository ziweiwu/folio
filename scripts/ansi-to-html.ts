/**
 * ANSI to HTML.
 *
 * Colour is the one thing that cannot be reviewed through a terminal
 * transcript: escape codes either arrive as mojibake or get stripped entirely.
 * Converting real rendered frames to HTML makes the review honest — what you
 * see is the app's actual output, not a mock-up of it.
 */

const CUBE = [0, 95, 135, 175, 215, 255];
const BASE16 = [
  '#000000', '#cd3131', '#0dbc79', '#e5e510', '#2472c8', '#bc3fbc', '#11a8cd', '#e5e5e5',
  '#666666', '#f14c4c', '#23d18b', '#f5f543', '#3b8eea', '#d670d6', '#29b8db', '#ffffff',
];

function xterm256(n: number): string {
  if (n < 16) return BASE16[n]!;
  if (n < 232) {
    const i = n - 16;
    const r = CUBE[Math.floor(i / 36)]!;
    const g = CUBE[Math.floor((i % 36) / 6)]!;
    const b = CUBE[i % 6]!;
    return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
  const v = (8 + (n - 232) * 10).toString(16).padStart(2, '0');
  return `#${v}${v}${v}`;
}

type State = {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strike: boolean;
};

const blank = (): State => ({
  fg: null, bg: null, bold: false, dim: false,
  italic: false, underline: false, inverse: false, strike: false,
});

function applySgr(state: State, body: string): State {
  const s = { ...state };
  const codes = (body === '' ? '0' : body).split(';').map(Number);
  for (let i = 0; i < codes.length; i++) {
    const c = codes[i]!;
    if (c === 0) Object.assign(s, blank());
    else if (c === 1) s.bold = true;
    else if (c === 2) s.dim = true;
    else if (c === 3) s.italic = true;
    else if (c === 4) s.underline = true;
    else if (c === 7) s.inverse = true;
    else if (c === 9) s.strike = true;
    else if (c === 22) { s.bold = false; s.dim = false; }
    else if (c === 39) s.fg = null;
    else if (c === 49) s.bg = null;
    else if (c === 38 || c === 48) {
      const mode = codes[i + 1];
      let color: string | null = null;
      if (mode === 2) {
        color = `#${codes.slice(i + 2, i + 5).map((v) => (v || 0).toString(16).padStart(2, '0')).join('')}`;
        i += 4;
      } else if (mode === 5) {
        color = xterm256(codes[i + 2] ?? 0);
        i += 2;
      }
      if (c === 38) s.fg = color;
      else s.bg = color;
    } else if (c >= 30 && c <= 37) s.fg = BASE16[c - 30]!;
    else if (c >= 90 && c <= 97) s.fg = BASE16[c - 90 + 8]!;
    else if (c >= 40 && c <= 47) s.bg = BASE16[c - 40]!;
    else if (c >= 100 && c <= 107) s.bg = BASE16[c - 100 + 8]!;
  }
  return s;
}

function css(s: State, defaults: { fg: string; bg: string }): string {
  const fg = s.inverse ? (s.bg ?? defaults.bg) : s.fg;
  const bg = s.inverse ? (s.fg ?? defaults.fg) : s.bg;
  const out: string[] = [];
  if (fg) out.push(`color:${fg}`);
  if (bg) out.push(`background:${bg}`);
  if (s.bold) out.push('font-weight:700');
  if (s.dim) out.push('opacity:.65');
  if (s.italic) out.push('font-style:italic');
  const deco = [s.underline ? 'underline' : '', s.strike ? 'line-through' : ''].filter(Boolean);
  if (deco.length) out.push(`text-decoration:${deco.join(' ')}`);
  return out.join(';');
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One frame of ANSI rows to an HTML fragment. */
export function ansiToHtml(rows: string[], defaults: { fg: string; bg: string }): string {
  let state = blank();
  const out: string[] = [];

  for (const row of rows) {
    let html = '';
    let i = 0;
    let open = false;
    const close = () => {
      if (open) { html += '</span>'; open = false; }
    };
    const openWith = () => {
      const style = css(state, defaults);
      if (style !== '') { html += `<span style="${style}">`; open = true; }
    };

    while (i < row.length) {
      if (row[i] === '\x1b') {
        const sgr = /^\x1b\[([0-9;:]*)m/.exec(row.slice(i));
        if (sgr) {
          close();
          state = applySgr(state, sgr[1]!);
          openWith();
          i += sgr[0].length;
          continue;
        }
        // OSC 8 hyperlinks carry no visual weight here; drop the wrapper.
        const osc = /^\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/.exec(row.slice(i));
        if (osc) { i += osc[0].length; continue; }
        const other = /^\x1b\[[0-9;?]*[a-zA-Z]/.exec(row.slice(i));
        if (other) { i += other[0].length; continue; }
        i += 1;
        continue;
      }
      if (!open) openWith();
      const ch = String.fromCodePoint(row.codePointAt(i)!);
      html += escapeHtml(ch);
      i += ch.length;
    }
    close();
    out.push(html === '' ? '&nbsp;' : html);
  }
  return out.join('\n');
}
