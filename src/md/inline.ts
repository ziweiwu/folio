import type { Token, Tokens } from 'marked';
import type { Style } from '../core/ansi.js';
import type { LinkMode, Span, Theme } from '../core/types.js';

export type InlineContext = {
  theme: Theme;
  links: LinkMode;
  /** Collects hrefs for `--links=ref`; the layout prints them as a footer. */
  refs: string[];
};

/**
 * The named references worth spelling out.
 *
 * Deliberately not the full HTML set — that is two thousand entries and a
 * dependency, for a viewer whose first pillar is staying small. This is the
 * list that actually turns up in README files, and anything outside it is left
 * as the author wrote it, which is honest: a reader who sees `&starf;` can at
 * least tell it was in the file.
 */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
  copy: '©', reg: '®', trade: '™', deg: '°', plusmn: '±',
  times: '×', divide: '÷', frac12: '½', frac14: '¼', frac34: '¾',
  laquo: '«', raquo: '»', lsquo: '\u2018', rsquo: '\u2019', ldquo: '\u201c', rdquo: '\u201d',
  bull: '•', middot: '·', dagger: '†', sect: '§', para: '¶',
  larr: '←', uarr: '↑', rarr: '→', darr: '↓', harr: '↔',
  ne: '≠', le: '≤', ge: '≥', asymp: '≈', minus: '−',
  euro: '€', pound: '£', yen: '¥', cent: '¢',
};

/** Highest code point Unicode defines; anything above it is not a character. */
const MAX_CODE_POINT = 0x10ffff;

/** `&#x2192;` counts in hexadecimal, `&#8594;` in decimal. */
const HEX = 16;
const DECIMAL = 10;

/**
 * A numeric reference, decoded — unless what it spells is not text.
 *
 * The source is sanitised on the way in, before anything parses it (I-29), so
 * a reference decoded *here* would slip past that: `&#27;` is an escape and
 * `&#7;` is the bell, and a document that could spell either would be driving
 * the terminal again through a side door. Control bytes, surrogates and
 * out-of-range values are therefore left as the source text rather than
 * turned into the byte they name.
 */
function decodeNumeric(body: string): string | null {
  const hex = body[0] === 'x' || body[0] === 'X';
  const code = Number.parseInt(hex ? body.slice(1) : body, hex ? HEX : DECIMAL);
  if (!Number.isInteger(code) || code > MAX_CODE_POINT) return null;
  // C0, DEL and C1, then the surrogate range, which is not a character at all.
  if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return null;
  if (code >= 0xd800 && code <= 0xdfff) return null;
  return String.fromCodePoint(code);
}

const ENTITY = /&(#[0-9]+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g;

export function decodeEntities(s: string): string {
  return s.replace(ENTITY, (whole, body: string) =>
    (body[0] === '#' ? decodeNumeric(body.slice(1)) : ENTITIES[body] ?? null) ?? whole,
  );
}

function merge(base: Style, extra: Style): Style {
  return { ...base, ...extra };
}

/**
 * Inline tokens to styled spans.
 *
 * `strong`, `em` and `del` add attributes without touching the foreground, so
 * bold text inside a blockquote or a list keeps that block's colour instead of
 * snapping back to body colour mid-sentence.
 */
export function inlineSpans(tokens: Token[] | undefined, base: Style, ctx: InlineContext): Span[] {
  const out: Span[] = [];
  if (!tokens) return out;
  const { theme } = ctx;

  for (const t of tokens) {
    switch (t.type) {
      case 'text': {
        const tok = t as Tokens.Text;
        if (tok.tokens && tok.tokens.length > 0) out.push(...inlineSpans(tok.tokens, base, ctx));
        else out.push({ text: decodeEntities(tok.text), style: base });
        break;
      }
      case 'escape':
        out.push({ text: decodeEntities((t as Tokens.Escape).text), style: base });
        break;
      case 'strong':
        out.push(...inlineSpans((t as Tokens.Strong).tokens, merge(base, { bold: true }), ctx));
        break;
      case 'em':
        out.push(...inlineSpans((t as Tokens.Em).tokens, merge(base, { italic: true }), ctx));
        break;
      case 'del':
        out.push(
          ...inlineSpans((t as Tokens.Del).tokens, merge(base, { strike: true, ...theme.strike }), ctx),
        );
        break;
      case 'codespan': {
        // A hair of padding either side keeps the tinted background off the
        // neighbouring words.
        const text = decodeEntities((t as Tokens.Codespan).text);
        out.push({ text: ` ${text} `, style: merge(base, theme.inlineCode) });
        break;
      }
      case 'br':
        out.push({ text: '\n', style: base });
        break;
      case 'link': {
        const tok = t as Tokens.Link;
        const label = inlineSpans(tok.tokens, merge(base, theme.link), ctx);
        const href = tok.href ?? '';
        /* The href rides on the span in every mode, not just `osc8`. It is what
           the viewer follows when you press Enter, and dropping it because the
           terminal cannot make it clickable would make link-following depend
           on a display setting. */
        out.push(...label.map((s) => (href === '' ? s : { ...s, link: href })));
        if (ctx.links === 'ref') {
          ctx.refs.push(href);
          out.push({ text: `[${ctx.refs.length}]`, style: merge(base, theme.linkUrl) });
        } else if (ctx.links === 'plain') {
          const shown = label.map((s) => s.text).join('');
          if (href !== '' && href !== shown) {
            out.push({ text: ` (${href})`, style: merge(base, theme.linkUrl) });
          }
        }
        break;
      }
      case 'image': {
        const tok = t as Tokens.Image;
        const alt = decodeEntities(tok.text || tok.title || 'image');
        out.push({ text: `\u{1F5BC} ${alt}`, style: merge(base, theme.image) });
        break;
      }
      case 'html': {
        // Inline HTML is shown as-is but dimmed: silently dropping it loses
        // content, and rendering it as body text implies it is prose.
        const text = (t as Tokens.HTML).text.replace(/\n/g, ' ');
        if (text.trim() !== '') out.push({ text, style: merge(base, theme.faint) });
        break;
      }
      default: {
        const raw = (t as { raw?: string; text?: string }).text ?? (t as { raw?: string }).raw ?? '';
        if (raw !== '') out.push({ text: decodeEntities(raw), style: base });
      }
    }
  }
  return out;
}
