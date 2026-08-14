import { createHighlighterCore, type HighlighterCore } from '@shikijs/core';
import { createJavaScriptRegexEngine } from '@shikijs/engine-javascript';
import type { HighlightFn, Span } from '../core/types.js';

/**
 * Syntax highlighting, loaded on demand.
 *
 * Two costs are worth avoiding here. The `shiki` meta-package bundles every
 * grammar and theme, which is megabytes of parse work at startup for a document
 * that uses one language; importing `@shikijs/langs/<lang>` individually keeps
 * the cost proportional to the document. And the oniguruma WASM engine adds
 * both weight and an async init, so we use the JavaScript regex engine instead.
 */

/** Names people actually type in a fence, mapped to grammars that exist. */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  tsx: 'tsx',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  golang: 'go',
  yml: 'yaml',
  md: 'markdown',
  mdx: 'mdx',
  dockerfile: 'docker',
  'c++': 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  kt: 'kotlin',
  ps1: 'powershell',
  psql: 'sql',
  htm: 'html',
  vue: 'vue',
  tf: 'terraform',
  make: 'makefile',
  plaintext: '',
  text: '',
  txt: '',
  '': '',
};

export function normalizeLang(lang: string): string {
  // A fence may carry more than a language: ```ts title="x"
  const first = lang.trim().split(/[\s,{]/)[0]!.toLowerCase();
  return ALIASES[first] ?? first;
}

const FENCE_RE = /^[ \t]*(?:```+|~~~+)[ \t]*([^\n`]*)$/gm;

/** Languages a document actually uses, so only those grammars get loaded. */
export function collectLanguages(src: string): string[] {
  const found = new Set<string>();
  for (const m of src.matchAll(FENCE_RE)) {
    const lang = normalizeLang(m[1] ?? '');
    if (lang !== '') found.add(lang);
  }
  return [...found].sort();
}

async function loadLang(name: string): Promise<unknown | null> {
  try {
    const mod = (await import(`@shikijs/langs/${name}`)) as { default: unknown };
    return mod.default;
  } catch {
    // An unknown fence language is a normal thing to find in a README, not an
    // error worth reporting. See I-13.
    return null;
  }
}

async function loadTheme(name: string): Promise<unknown | null> {
  try {
    const mod = (await import(`@shikijs/themes/${name}`)) as { default: unknown };
    return mod.default;
  } catch {
    return null;
  }
}

/** Shiki's fontStyle is a bitmask. */
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;

export type Highlighter = { fn: HighlightFn; dispose: () => void };

/**
 * Build a highlighter for exactly the languages a document uses.
 *
 * Returns null when nothing could be loaded, which the layout treats as "render
 * code blocks plain" rather than as a failure.
 */
export async function createHighlighter(
  themeName: string,
  langs: string[],
): Promise<Highlighter | null> {
  if (langs.length === 0) return null;

  const [theme, ...loaded] = await Promise.all([loadTheme(themeName), ...langs.map(loadLang)]);
  if (!theme) return null;

  const available = new Set<string>();
  const grammars: unknown[] = [];
  loaded.forEach((g, i) => {
    if (g) {
      grammars.push(g);
      available.add(langs[i]!);
    }
  });
  if (grammars.length === 0) return null;

  let core: HighlighterCore;
  try {
    core = await createHighlighterCore({
      themes: [theme as never],
      langs: grammars as never[],
      /* `forgiving` matters: the JavaScript regex engine cannot compile every
         TextMate pattern oniguruma accepts. Without it, one exotic grammar
         throws and takes the whole highlighter with it; with it, the offending
         pattern is skipped and the rest of the grammar still works. */
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  } catch {
    return null;
  }

  const themeId = (theme as { name?: string }).name ?? themeName;

  const fn: HighlightFn = (code, rawLang) => {
    const lang = normalizeLang(rawLang);
    if (!available.has(lang)) return null;
    try {
      return core.codeToTokensBase(code, { lang, theme: themeId }).map((row) =>
        row.map((tok): Span => {
          const fs = tok.fontStyle ?? 0;
          const style: Span['style'] = {};
          if (tok.color) style.fg = tok.color;
          if (fs & ITALIC) style.italic = true;
          if (fs & BOLD) style.bold = true;
          if (fs & UNDERLINE) style.underline = true;
          return { text: tok.content, style };
        }),
      );
    } catch {
      return null;
    }
  };

  return { fn, dispose: () => core.dispose() };
}
