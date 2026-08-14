import type { LinkMode } from './types.js';

export type Options = {
  /** The file to read, or null to read stdin. */
  file: string | null;
  /** Cap on the text column; 0 fills the terminal. */
  maxWidth: number;
  theme: 'auto' | 'dark' | 'light';
  plain: boolean;
  /** False prints the document and exits, even on a terminal. */
  pager: boolean;
  lineNumbers: boolean;
  links: LinkMode;
  watch: boolean;
  /** null follows the file extension; true and false force the choice. */
  markdown: boolean | null;
  /** Chop wide code and tables to fit instead of scrolling sideways over them. */
  wrap: boolean;
  /** Reopen a file where it was last left. */
  resume: boolean;
  help: boolean;
  version: boolean;
};

export type ParseResult =
  | { ok: true; options: Options }
  | { ok: false; message: string; code: 2 };

const DEFAULTS: Options = {
  file: null,
  maxWidth: 88,
  theme: 'auto',
  plain: false,
  pager: true,
  lineNumbers: false,
  links: 'osc8',
  watch: false,
  markdown: null,
  wrap: false,
  resume: true,
  help: false,
  version: false,
};

const bad = (message: string): ParseResult => ({ ok: false, message, code: 2 });

function parseWidth(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  // Below about 20 columns nothing can be laid out; 0 means "fill the terminal".
  if (n > 0 && n < 20) return null;
  return n;
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const o: Options = { ...DEFAULTS };
  const rest = [...argv];

  while (rest.length > 0) {
    const arg = rest.shift()!;
    const eq = arg.indexOf('=');
    const [flag, inline] = eq > 1 && arg.startsWith('-') ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];

    switch (flag) {
      case '-h':
      case '--help':
        o.help = true;
        break;
      case '--version':
        o.version = true;
        break;
      case '-w':
      case '--width': {
        const w = parseWidth(inline ?? rest.shift());
        if (w === null) return bad('--width takes 0 (fill the terminal) or a number of columns, at least 20');
        o.maxWidth = w;
        break;
      }
      case '--theme': {
        const t = inline ?? rest.shift();
        if (t !== 'auto' && t !== 'dark' && t !== 'light') return bad('--theme takes auto, dark or light');
        o.theme = t;
        break;
      }
      case '--links': {
        const l = inline ?? rest.shift();
        if (l !== 'osc8' && l !== 'ref' && l !== 'plain') return bad('--links takes osc8, ref or plain');
        o.links = l;
        break;
      }
      case '-p':
      case '--plain':
        o.plain = true;
        break;
      case '-n':
      case '--line-numbers':
        o.lineNumbers = true;
        break;
      case '--no-pager':
        o.pager = false;
        break;
      case '--watch':
        o.watch = true;
        break;
      case '--text':
        o.markdown = false;
        break;
      case '--markdown':
        o.markdown = true;
        break;
      case '--wrap':
        o.wrap = true;
        break;
      case '--no-resume':
        o.resume = false;
        break;
      case '-':
        o.file = null;
        break;
      default: {
        if (flag.startsWith('-') && flag !== '-') return bad(`unknown option ${flag}`);
        if (o.file !== null) return bad('only one file can be read at a time');
        o.file = flag;
      }
    }
  }

  return { ok: true, options: o };
}
