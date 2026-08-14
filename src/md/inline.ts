import type { Token, Tokens } from 'marked';
import type { Style } from '../core/ansi.js';
import type { LinkMode, Span, Theme } from '../core/types.js';

export type InlineContext = {
  theme: Theme;
  links: LinkMode;
  /** Collects hrefs for `--links=ref`; the layout prints them as a footer. */
  refs: string[];
};

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
  '&hellip;': '…',
  '&mdash;': '—',
  '&ndash;': '–',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|hellip|mdash|ndash);/g, (m) => ENTITIES[m] ?? m);
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
