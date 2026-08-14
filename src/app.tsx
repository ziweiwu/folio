import { Box, Text, useApp, useInput, useStdin, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ColorLevel } from './core/ansi.js';
import type { HighlightFn, Theme } from './core/types.js';
import type { Options } from './core/options.js';
import { parseBurst } from './core/keys.js';
import { osc52 } from './core/clipboard.js';
import { classifyLink, findAnchor } from './core/links.js';
import { anchorOffset } from './core/position.js';
import { findMatches, highlightRow, nextMatch, type Highlight, type Match } from './core/search.js';
import { useScroll } from './hooks/useScroll.js';
import { isMouseSequence, useMouse } from './hooks/useMouse.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { layoutDoc } from './md/layout.js';
import { layoutText } from './md/text.js';
import { composeFrame, maxHOffset, sectionAt, statusBar } from './ui/chrome.js';
import { centre, overlayRows } from './ui/overlay.js';
import { helpPane, searchBar, tocPane } from './ui/panes.js';

const HINTS = '/ search   t toc   ? keys   q quit';

export type Source = { text: string; highlight?: HighlightFn };

export type AppProps = {
  initial: Source;
  name: string;
  options: Options;
  theme: Theme;
  level: ColorLevel;
  mouse: boolean;
  /** Re-read the file, rebuilding the highlighter for any new languages. */
  reload?: () => Promise<Source>;
  /** Subscribe to changes on disk; returns an unsubscribe. Used by --watch. */
  watch?: (onChange: () => void) => () => void;
  /**
   * Resolves to the same document with syntax highlighting attached.
   *
   * Building the grammars costs a few milliseconds per code block, which is
   * nothing for a README and around half a second for a document with two
   * hundred of them. The first frame is therefore drawn from the unhighlighted
   * document and replaced when the highlighter is ready, so opening a file is
   * always immediate.
   */
  upgrade?: () => Promise<Source>;
  /** False shows the file verbatim, for formats this viewer does not parse. */
  markdown?: boolean;
  overflow: 'wrap' | 'scroll';
  /**
   * Load another document by path, relative to the one already open.
   *
   * Absent when reading stdin, where "relative to the current document" has no
   * meaning. Resolving lives with the caller because only it knows where the
   * open file is; the app only knows it wants to go somewhere.
   */
  open?: (path: string) => Promise<{ source: Source; name: string; markdown: boolean } | null>;
  /** Block to resume at, from a previous read of this file. */
  startBlock?: number | null;
  /** Reports the block at the top of the viewport, so it can be remembered. */
  onPosition?: (block: number) => void;
};

type Mode = 'doc' | 'search' | 'toc' | 'help';

export function App({ initial, name, options, theme, level, mouse, reload, watch, upgrade, markdown = true, overflow, open, startBlock = null, onPosition }: AppProps) {
  const { exit } = useApp();
  const { stdin } = useStdin();
  const { stdout } = useStdout();
  const { columns, rows } = useTerminalSize();

  const [source, setSource] = useState(initial);
  const [title, setTitle] = useState(name);
  const [parseAsMarkdown, setParseAsMarkdown] = useState(markdown);
  const [linkIndex, setLinkIndex] = useState(-1);
  const [mode, setMode] = useState<Mode>('doc');
  const [query, setQuery] = useState('');
  const [committed, setCommitted] = useState('');
  const [matchIndex, setMatchIndex] = useState(-1);
  const [tocIndex, setTocIndex] = useState(0);
  const [hOffset, setHOffset] = useState(0);
  const back = useRef<Array<{ source: Source; title: string; offset: number; markdown: boolean }>>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);

  // The status bar owns the last row; the scrollbar owns the last column.
  const height = Math.max(1, rows - 1);

  const doc = useMemo(
    () =>
      (parseAsMarkdown ? layoutDoc : layoutText)(source.text, {
        width: Math.max(4, columns - 1),
        maxWidth: options.maxWidth,
        theme,
        level,
        lineNumbers: options.lineNumbers,
        links: options.links,
        overflow,
        highlight: source.highlight,
      }),
    [source, columns, theme, level, parseAsMarkdown, overflow, options.maxWidth, options.lineNumbers, options.links],
  );

  const scroll = useScroll(
    doc.lines.length,
    height,
    startBlock === null ? 0 : anchorOffset(doc.lines, startBlock, height),
  );
  const { offset, scrollBy, scrollTo } = scroll;

  /* Bounded by the widest row currently on screen, not by the whole document:
     how far right you can go depends on what you are looking at. */
  const maxH = maxHOffset(doc, { offset, height, total: doc.lines.length }, columns);
  /** Roughly a word, so `l` feels like reading rather than nudging. */
  const H_STEP = 8;

  /* Resize re-anchoring (I-6). The offset is meaningless across a re-layout —
     the same row is at a different index — so the block the viewport was
     showing is remembered instead, and the offset is recomputed from it. */
  const anchorRef = useRef(0);
  const lastWidthRef = useRef(columns);
  useEffect(() => {
    const block = doc.lines[offset]?.block ?? 0;
    anchorRef.current = block;
    onPosition?.(block);
  }, [offset, doc, onPosition]);

  /* The offset itself is seeded above; this only says so, once. */
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current || startBlock === null || doc.lines.length === 0) return;
    announced.current = true;
    if (offset > 0) setStatus('resumed where you left off');
  }, [startBlock, doc, offset]);

  useEffect(() => {
    if (lastWidthRef.current === columns) return;
    lastWidthRef.current = columns;
    scrollTo(anchorOffset(doc.lines, anchorRef.current, height));
  }, [columns, doc, height, scrollTo]);

  /** Every followable link in the document, in reading order. */
  const links = useMemo(
    () =>
      doc.lines.flatMap((line, row) =>
        (line.links ?? []).map((t) => ({ href: t.href, start: t.start, end: t.end, row })),
      ),
    [doc],
  );

  const matches = useMemo(() => findMatches(doc.lines, committed), [doc, committed]);
  const liveMatches = useMemo(
    () => (mode === 'search' ? findMatches(doc.lines, query) : matches),
    [mode, query, doc, matches],
  );

  useMouse(stdin, mouse, scrollBy);

  const quit = useCallback(() => exit(), [exit]);

  /** Put a hit a third of the way down rather than at the very top, so there is
   *  context above it. */
  const revealLine = useCallback(
    (line: number) => scrollTo(Math.max(0, line - Math.floor(height / 3))),
    [scrollTo, height],
  );

  const jumpToMatch = useCallback(
    (index: number, list: readonly Match[]) => {
      if (list.length === 0) return;
      const wrapped = ((index % list.length) + list.length) % list.length;
      setMatchIndex(wrapped);
      revealLine(list[wrapped]!.line);
    },
    [revealLine],
  );

  const goTo = useCallback(
    (next: { source: Source; name: string; markdown: boolean }, anchor: string | null, remember: boolean) => {
      if (remember) back.current.push({ source, title, offset, markdown: parseAsMarkdown });
      setSource(next.source);
      setTitle(next.name);
      setParseAsMarkdown(next.markdown);
      setLinkIndex(-1);
      setHOffset(0);
      // The anchor is resolved on the next document, which has not been laid
      // out yet, so it is handed to an effect rather than applied here.
      setPendingAnchor(anchor);
      scrollTo(0);
    },
    [source, title, offset, parseAsMarkdown, scrollTo],
  );

  const follow = useCallback(
    async (href: string) => {
      const link = classifyLink(href);
      if (!link) return;
      if (link.kind === 'external') {
        // Deliberately not opened: a pager that launches a browser is a
        // surprise, and OSC 8 already makes these clickable.
        setStatus(link.href);
        return;
      }
      if (link.kind === 'anchor') {
        const row = findAnchor(doc.toc, link.anchor);
        if (row === -1) setStatus(`no heading matching #${link.anchor}`);
        else scrollTo(Math.max(0, row - 1));
        return;
      }
      if (!open) {
        setStatus('cannot follow a file link when reading from stdin');
        return;
      }
      const next = await open(link.path);
      if (!next) setStatus(`${link.path}: not found`);
      else goTo(next, link.anchor, true);
    },
    [doc, open, goTo, scrollTo],
  );

  const goBack = useCallback(() => {
    const prev = back.current.pop();
    if (!prev) {
      setStatus('nothing to go back to');
      return;
    }
    setSource(prev.source);
    setTitle(prev.title);
    setParseAsMarkdown(prev.markdown);
    setLinkIndex(-1);
    setHOffset(0);
    scrollTo(prev.offset);
  }, [scrollTo]);

  const doReload = useCallback(async () => {
    if (!reload) return;
    setStatus('reloading…');
    try {
      setSource(await reload());
      setStatus('reloaded');
    } catch (err) {
      setStatus(`could not reload: ${(err as Error).message}`);
    }
  }, [reload]);

  useEffect(() => {
    if (pendingAnchor === null) return;
    const row = findAnchor(doc.toc, pendingAnchor);
    setPendingAnchor(null);
    if (row === -1) setStatus(`no heading matching #${pendingAnchor}`);
    else scrollTo(Math.max(0, row - 1));
  }, [pendingAnchor, doc, scrollTo]);

  useEffect(() => {
    if (!upgrade) return;
    let live = true;
    void upgrade().then((next) => {
      if (live) setSource(next);
    });
    return () => {
      live = false;
    };
  }, [upgrade]);

  useEffect(() => {
    if (!watch) return;
    return watch(() => {
      void doReload();
    });
  }, [watch, doReload]);

  useEffect(() => {
    if (status === null) return;
    const t = setTimeout(() => setStatus(null), 1800);
    return () => clearTimeout(t);
  }, [status]);

  useInput((raw, key) => {
    // Mouse reports reach Ink's key parser too; without this a scroll would
    // register as a burst of keystrokes.
    if (isMouseSequence(raw)) return;

    if (mode === 'search') {
      if (key.escape) {
        setMode('doc');
        setQuery(committed);
        return;
      }
      if (key.return) {
        setCommitted(query);
        setMode('doc');
        const found = findMatches(doc.lines, query);
        if (found.length === 0) setStatus(query === '' ? null : `no match for "${query}"`);
        else jumpToMatch(nextMatch(found, offset - 1, false), found);
        return;
      }
      if (key.backspace || key.delete) {
        setQuery((q) => q.slice(0, -1));
        return;
      }
      if (raw && !key.ctrl && !key.meta) setQuery((q) => q + raw);
      return;
    }

    /* A held key arrives as one chunk, so `jjjj` is four lines, not one
       unrecognised keystroke. Search mode is exempt: there a burst really is
       the text the user typed. */
    const { key: input, repeat } = parseBurst(raw, key);

    if (mode === 'toc') {
      // q quits from anywhere. An overlay that swallowed it would make the one
      // key everybody already knows mean two different things.
      if (input === 'q') {
        quit();
        return;
      }
      if (key.escape || input === 't') {
        setMode('doc');
        return;
      }
      if (key.return) {
        setMode('doc');
        const entry = doc.toc[tocIndex];
        if (entry) scrollTo(Math.max(0, entry.line - 1));
        return;
      }
      if (input === 'j' || key.downArrow) setTocIndex((i) => Math.min(i + repeat, doc.toc.length - 1));
      if (input === 'k' || key.upArrow) setTocIndex((i) => Math.max(i - repeat, 0));
      if (input === 'g' || key.pageUp) setTocIndex(0);
      if (input === 'G' || key.pageDown) setTocIndex(Math.max(0, doc.toc.length - 1));
      return;
    }

    if (mode === 'help') {
      if (input === 'q') quit();
      else setMode('doc');
      return;
    }

    switch (true) {
      case input === 'q' || key.escape || (key.ctrl && input === 'c'):
        quit();
        return;
      case input === 'j' || key.downArrow:
        scrollBy(repeat);
        return;
      case input === 'k' || key.upArrow:
        scrollBy(-repeat);
        return;
      case input === 'd' || (key.ctrl && input === 'd'):
        scrollBy(Math.floor(height / 2) * repeat);
        return;
      case input === 'u' || (key.ctrl && input === 'u'):
        scrollBy(-Math.floor(height / 2) * repeat);
        return;
      case input === 'f' || input === ' ' || key.pageDown || (key.ctrl && input === 'f'):
        scrollBy((height - 2) * repeat);
        return;
      case input === 'b' || key.pageUp || (key.ctrl && input === 'b'):
        scrollBy(-(height - 2) * repeat);
        return;
      case input === 'h' || key.leftArrow:
        setHOffset((x) => Math.max(0, x - H_STEP * repeat));
        return;
      case input === 'l' || key.rightArrow:
        setHOffset((x) => Math.min(maxH, x + H_STEP * repeat));
        return;
      case input === '0':
        setHOffset(0);
        return;
      case input === 'g':
        scrollTo(0);
        setHOffset(0);
        return;
      case input === 'G':
        scrollTo(doc.lines.length);
        setHOffset(0);
        return;
      case key.tab: {
        if (links.length === 0) {
          setStatus('no links in this document');
          return;
        }
        // Start from what is on screen rather than from the top of the file,
        // so Tab picks up where the reader is looking.
        const step = key.shift ? -1 : 1;
        const from =
          linkIndex >= 0
            ? linkIndex + step * repeat
            : step > 0
              ? Math.max(0, links.findIndex((l) => l.row >= offset))
              : links.length - 1;
        const at = ((from % links.length) + links.length) % links.length;
        setLinkIndex(at);
        revealLine(links[at]!.row);
        return;
      }
      case key.return: {
        const link = links[linkIndex];
        if (!link) setStatus('press tab to pick a link first');
        else void follow(link.href);
        return;
      }
      case key.backspace || key.delete:
        goBack();
        return;
      case input === '/':
        setQuery('');
        setMode('search');
        return;
      case input === 'n':
        if (matches.length === 0) setStatus('nothing to search for yet');
        else jumpToMatch(nextMatch(matches, offset, false), matches);
        return;
      case input === 'N':
        if (matches.length === 0) setStatus('nothing to search for yet');
        else jumpToMatch(nextMatch(matches, offset, true), matches);
        return;
      case input === 't':
        setTocIndex(Math.max(0, doc.toc.findIndex((e) => e.line > offset) - 1));
        setMode('toc');
        return;
      case input === '?':
        setMode('help');
        return;
      case input === 'y': {
        // The block you can see is the block you meant. Several visible, the
        // first — anything cleverer would need a selection the reader has to
        // learn about first.
        const block = doc.code.find((c) => c.to >= offset && c.from < offset + height);
        if (!block) {
          setStatus('no code block on screen to copy');
          return;
        }
        const copied = osc52(block.code);
        if (!copied.ok) {
          setStatus(copied.reason);
          return;
        }
        stdout.write(copied.sequence);
        const count = block.code.split('\n').length;
        setStatus(`sent ${count} line${count === 1 ? '' : 's'} to the clipboard`);
        return;
      }
      case input === 'r':
        void doReload();
        return;
      default:
    }
  });

  const selected = links[linkIndex];

  const decorate = useCallback(
    (row: string, line: number): string => {
      const ranges: Highlight[] = [];
      for (const [i, m] of liveMatches.entries()) {
        if (m.line === line) {
          ranges.push({ start: m.start, end: m.end, style: i === matchIndex ? theme.matchCurrent : theme.match });
        }
      }
      /* The link cursor is positioned in cells already, because a row's link
         ranges were measured when it was laid out. */
      if (selected && selected.row === line) {
        ranges.push({ start: selected.start, end: selected.end, style: theme.matchCurrent, cells: true });
      }
      if (ranges.length === 0) return row;
      return highlightRow(row, doc.lines[line]?.plain ?? '', ranges, columns - 1, level);
    },
    [liveMatches, matchIndex, selected, doc, columns, theme, level],
  );

  let frame = composeFrame(
    doc,
    { offset, height, total: doc.lines.length, hOffset },
    columns,
    theme,
    level,
    liveMatches.length > 0 || selected ? decorate : undefined,
  );

  if (mode === 'toc' || mode === 'help') {
    const pane = mode === 'toc' ? tocPane(doc, tocIndex, columns, height, theme, level) : helpPane(columns, theme, level);
    const at = centre(pane.width, pane.height, columns, height);
    frame = overlayRows(frame, pane.rows, at.top, at.left, columns, level);
  }

  const bar =
    mode === 'search'
      ? searchBar(query, liveMatches.length, true, columns, theme, level)
      : statusBar(
          {
            message: status,
            name: title,
            section: hOffset > 0 ? `↔ ${hOffset}` : sectionAt(doc, offset),
            offset,
            height,
            total: doc.lines.length,
            hints: HINTS,
          },
          columns,
          theme,
          level,
        );

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {frame.map((row, i) => (
        <Text key={i} wrap="truncate">
          {row}
        </Text>
      ))}
      <Text wrap="truncate">{bar}</Text>
    </Box>
  );
}
