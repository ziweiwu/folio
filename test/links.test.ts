import { describe, expect, it } from 'vitest';
import { classifyLink, findAnchor, slugify } from '../src/core/links.js';
import { linkRanges } from '../src/core/wrap.js';
import { ansiWidth, stripAnsi } from '../src/core/ansi.js';
import { highlightRow } from '../src/core/search.js';
import { layoutDoc } from '../src/md/layout.js';
import { fixture, opts } from './helpers.js';
import { pickTheme } from '../src/ui/theme.js';

const theme = pickTheme('dark');
const wiki = (name: string) => fixture(`wiki/${name}`);

describe('classifying a link', () => {
  it('separates anchors, files and anything with a scheme', () => {
    expect(classifyLink('#setup')).toEqual({ kind: 'anchor', anchor: 'setup' });
    expect(classifyLink('guide.md')).toEqual({ kind: 'file', path: 'guide.md', anchor: null });
    expect(classifyLink('guide.md#setup')).toEqual({ kind: 'file', path: 'guide.md', anchor: 'setup' });
    expect(classifyLink('https://example.com')).toEqual({ kind: 'external', href: 'https://example.com' });
    expect(classifyLink('mailto:a@b.c')).toEqual({ kind: 'external', href: 'mailto:a@b.c' });
    // Protocol-relative is just as external as an explicit scheme.
    expect(classifyLink('//example.com/x')).toEqual({ kind: 'external', href: '//example.com/x' });
  });

  it('decodes percent-escapes, so a link to a file with a space resolves', () => {
    expect(classifyLink('Some%20Note.md')).toEqual({ kind: 'file', path: 'Some Note.md', anchor: null });
  });

  it('ignores an empty target', () => {
    expect(classifyLink('')).toBeNull();
    expect(classifyLink('   ')).toBeNull();
  });

  it('does not mistake a Windows-style path for a scheme', () => {
    expect(classifyLink('./notes/a.md')).toMatchObject({ kind: 'file', path: './notes/a.md' });
  });
});

describe('anchors', () => {
  it('slugs headings the way markdown files link to them', () => {
    expect(slugify('Why another one?')).toBe('why-another-one');
    expect(slugify('  Setup & Config  ')).toBe('setup--config');
    expect(slugify('宽字符测试')).toBe('宽字符测试');
  });

  it('finds a heading by its slug', () => {
    const doc = layoutDoc(wiki('index.md'), opts());
    expect(findAnchor(doc.toc, 'the-second-heading')).toBeGreaterThan(0);
    expect(findAnchor(doc.toc, 'The Second Heading')).toBeGreaterThan(0);
    expect(findAnchor(doc.toc, 'nowhere-at-all')).toBe(-1);
  });
});

describe('links on a rendered row', () => {
  it('records where each link sits, in display cells', () => {
    const doc = layoutDoc('see [the guide](guide.md) now\n', opts({ level: 0, width: 60, maxWidth: 0 }));
    const line = doc.lines[0]!;
    expect(line.links).toHaveLength(1);
    const [link] = line.links!;
    expect(link!.href).toBe('guide.md');
    expect(line.plain.slice(link!.start, link!.end)).toBe('the guide');
  });

  it('I-20 carries the target in every link mode, not just the clickable one', () => {
    for (const mode of ['osc8', 'ref', 'plain'] as const) {
      const doc = layoutDoc('[a](guide.md)\n', opts({ links: mode }));
      expect(doc.lines[0]!.links?.[0]?.href).toBe('guide.md');
    }
  });

  it('emits the OSC 8 escape only in osc8 mode', () => {
    const osc8 = layoutDoc('[a](https://x.dev)\n', opts({ links: 'osc8' }));
    const plain = layoutDoc('[a](https://x.dev)\n', opts({ links: 'plain' }));
    expect(osc8.lines[0]!.ansi).toContain('\x1b]8;;https://x.dev');
    expect(plain.lines[0]!.ansi).not.toContain('\x1b]8;;');
  });

  it('treats a styled label as one target, not several', () => {
    const doc = layoutDoc('[**bold** and plain](guide.md)\n', opts({ level: 0 }));
    expect(doc.lines[0]!.links).toHaveLength(1);
  });

  it('measures wide characters in cells, so the cursor lands on the label', () => {
    const spans = [
      { text: '你好', style: {} },
      { text: 'link', style: {}, link: 'x.md' },
    ];
    expect(linkRanges(spans)).toEqual([{ href: 'x.md', start: 4, end: 8 }]);
  });

  it('highlights the selected link without changing the row width', () => {
    const doc = layoutDoc('see [the guide](guide.md) now\n', opts({ level: 3, width: 60, maxWidth: 0 }));
    const line = doc.lines[0]!;
    const [link] = line.links!;
    const out = highlightRow(
      line.ansi, line.plain,
      [{ start: link!.start, end: link!.end, style: theme.matchCurrent, cells: true }],
      60, 3,
    );
    expect(ansiWidth(out)).toBe(ansiWidth(line.ansi));
    expect(stripAnsi(out)).toBe(line.plain);
    expect(out).toContain('48;2;255;158;100');
  });
});

describe('wikilinks', () => {
  const doc = layoutDoc(wiki('index.md'), opts({ level: 0 }));
  const hrefs = doc.lines.flatMap((l) => (l.links ?? []).map((t) => t.href));

  it('resolves [[target]], [[target|label]] and [[target#anchor]]', () => {
    expect(hrefs).toContain('guide');
    expect(hrefs).toContain('guide#Setup');
    const text = doc.lines.map((l) => l.plain).join('\n');
    expect(text).toContain('a labelled one');
    // The brackets are consumed, not left in the output.
    expect(text).not.toContain('[[');
  });

  it('leaves brackets inside code alone', () => {
    const doc2 = layoutDoc('`[[not a link]]` and\n\n```\n[[nor this]]\n```\n', opts({ level: 0 }));
    const text = doc2.lines.map((l) => l.plain).join('\n');
    expect(text).toContain('[[not a link]]');
    expect(text).toContain('[[nor this]]');
    expect(doc2.lines.flatMap((l) => l.links ?? [])).toHaveLength(0);
  });

  it('ignores an empty wikilink', () => {
    const doc3 = layoutDoc('[[]] stays\n', opts({ level: 0 }));
    expect(doc3.lines[0]!.plain).toContain('[[]]');
  });
});
