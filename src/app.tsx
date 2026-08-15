import { Box, Text, useApp, useInput, usePaste, useStdin, useStdout } from 'ink';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ansiWidth, type ColorLevel } from './core/ansi.js';
import type { HighlightFn, Theme } from './core/types.js';
import type { Options } from './core/options.js';
import { splitBurst } from './core/keys.js';
import { osc52 } from './core/clipboard.js';
import { classifyLink, findAnchor } from './core/links.js';
import { anchorOffset } from './core/position.js';
import { findMatches, highlightRow, nextMatch, stepMatch, type Highlight, type Match } from './core/search.js';
import { useScroll } from './hooks/useScroll.js';
import { isMouseSequence, useMouse } from './hooks/useMouse.js';
import { useTerminalSize } from './hooks/useTerminalSize.js';
import { layoutDoc } from './md/layout.js';
import { layoutText } from './md/text.js';
import { composeFrame, maxHOffset, sectionAt, statusBar } from './ui/chrome.js';
import { centre, overlayRows } from './ui/overlay.js';
import { helpPane, searchBar, tocPane } from './ui/panes.js';

/* In display order, least important first: the bar drops them from the front
   when it is narrow, so `q quit` is the last thing to go and `? keys` the
   second last — between them a reader can always leave, or find everything
   else that is missing. */
const HINTS = ['/ search', 't toc', '? keys', 'q quit'];

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
  /**
   * Told when the reader goes back, so the host can unwind whatever `open`
   * advanced. Without it the host's idea of "the current file" only ever moves
   * forwards: after A → B → back, the next relative link from A resolved
   * against B's directory, and A's reading position was saved under B's path.
   */
  onBack?: () => void;
  /** Block to resume at, from a previous read of this file. */
  startBlock?: number | null;
  /** Reports the block at the top of the viewport, so it can be remembered. */
  onPosition?: (block: number) => void;
};

type Mode = 'doc' | 'search' | 'toc' | 'help';

/** What Ink tells us about a keystroke, and what we synthesise for one. */
type Keys = {
  escape: boolean;
  return: boolean;
  backspace: boolean;
  delete: boolean;
  tab: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  upArrow: boolean;
  downArrow: boolean;
  leftArrow: boolean;
  rightArrow: boolean;
  pageUp: boolean;
  pageDown: boolean;
};

const NO_KEYS: Keys = {
  escape: false,
  return: false,
  backspace: false,
  delete: false,
  tab: false,
  shift: false,
  ctrl: false,
  meta: false,
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageUp: false,
  pageDown: false,
};

/**
 * The flags for one keystroke taken out of a chunk.
 *
 * Ink's own flags describe the whole read, so they say nothing useful about a
 * keystroke in the middle of one: `cat⏎` sets `return` on nothing. Only the
 * two keys Ink leaves inside a text run need synthesising — the rest are
 * ordinary characters, and an escape sequence is never split in the first
 * place.
 */
function keysFor(ch: string): Keys {
  return { ...NO_KEYS, return: ch === '\r' || ch === '\n', tab: ch === '\t' };
}

export function App({ initial, name, options, theme, level, mouse, reload, watch, upgrade, markdown = true, overflow, open, onBack, startBlock = null, onPosition }: AppProps) {
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

  /* The key handler decides what a keystroke means from `mode`, `query` and
     the two cursors. Read from state, those are whatever React last rendered —
     and two keystrokes can land in one tick, before any re-render. `/cat`
     followed immediately by `q` then read `mode` as `doc` and *quit* instead of
     typing a `q`. So the handler branches on refs, which are current the
     instant a keystroke changes them, and the state exists to render with.
     Anything updated through a `setX(prev => …)` callback is already safe and
     is left alone. */
  const modeRef = useRef<Mode>(mode);
  const queryRef = useRef(query);
  const committedRef = useRef(committed);
  const matchIndexRef = useRef(matchIndex);
  const linkIndexRef = useRef(linkIndex);
  const tocIndexRef = useRef(tocIndex);
  const back = useRef<Array<{ source: Source; title: string; offset: number; markdown: boolean }>>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingAnchor, setPendingAnchor] = useState<string | null>(null);
  /* Where `goBack` wants to land. Deferred for the same reason the anchor above
     is: the document being returned to has not been laid out yet, so the scroll
     limits still describe the one being left. Restoring row 44 of a 200-row
     document while a 3-row one is still current clamped it to 0 and dropped the
     reader at the top of what they had already read. */
  const [pendingOffset, setPendingOffset] = useState<number | null>(null);

  const enterMode = useCallback((next: Mode) => {
    modeRef.current = next;
    setMode(next);
  }, []);
  const putQuery = useCallback((next: string) => {
    queryRef.current = next;
    setQuery(next);
  }, []);
  const putCommitted = useCallback((next: string) => {
    committedRef.current = next;
    setCommitted(next);
  }, []);
  const putMatchIndex = useCallback((next: number) => {
    matchIndexRef.current = next;
    setMatchIndex(next);
  }, []);
  const putLinkIndex = useCallback((next: number) => {
    linkIndexRef.current = next;
    setLinkIndex(next);
  }, []);
  const putTocIndex = useCallback((next: number) => {
    tocIndexRef.current = next;
    setTocIndex(next);
  }, []);

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
  const { offset, offsetRef, scrollBy, scrollTo } = scroll;

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
  const anchorDocRef = useRef(doc);

  /* Declared ahead of the recorder below, because effects run in declaration
     order and this one has to read `anchorRef` before that one rewrites it.
     A resize changes `columns` and `doc` in the same commit while `offset` is
     still counting rows in the layout being replaced — so the recorder indexed
     the new rows with an old row number, overwrote the anchor with a block the
     reader had never been on, and this effect then faithfully re-anchored to
     it. Going 120 columns to 50 on a 6,246-row document, 6,235 of the 6,246
     possible positions landed somewhere else, as much as 2,742 rows adrift, and
     the same wrong block was handed to `onPosition` and saved (I-21). */
  useEffect(() => {
    if (lastWidthRef.current === columns) return;
    lastWidthRef.current = columns;
    scrollTo(anchorOffset(doc.lines, anchorRef.current, height));
  }, [columns, doc, height, scrollTo]);

  useEffect(() => {
    if (anchorDocRef.current !== doc) {
      /* A re-layout has landed and `offset` still describes the one before it.
         Skip this pass rather than read a block at an index that means nothing
         in these rows. The re-anchor above has already put the viewport back on
         `anchorRef`, so it remains the block on screen, and the offset change
         that follows records from rows the number actually belongs to. */
      anchorDocRef.current = doc;
      return;
    }
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
      putMatchIndex(wrapped);
      revealLine(list[wrapped]!.line);
    },
    [revealLine, putMatchIndex],
  );

  /** Run the query and leave the prompt, seeding the cursor from the viewport. */
  const commitSearch = useCallback(
    (q: string) => {
      putCommitted(q);
      enterMode('doc');
      // A new search starts from what is on screen, not from the old cursor.
      putMatchIndex(-1);
      const found = findMatches(doc.lines, q);
      if (found.length === 0) setStatus(q === '' ? null : `no match for "${q}"`);
      else jumpToMatch(nextMatch(found, offset - 1, false), found);
    },
    [doc, offset, jumpToMatch, putCommitted, enterMode, putMatchIndex],
  );

  const goTo = useCallback(
    (next: { source: Source; name: string; markdown: boolean }, anchor: string | null, remember: boolean) => {
      if (remember) back.current.push({ source, title, offset, markdown: parseAsMarkdown });
      navGeneration.current++;
      setSource(next.source);
      setTitle(next.name);
      setParseAsMarkdown(next.markdown);
      putLinkIndex(-1);
      setHOffset(0);
      // The anchor is resolved on the next document, which has not been laid
      // out yet, so it is handed to an effect rather than applied here.
      setPendingAnchor(anchor);
      scrollTo(0);
    },
    [source, title, offset, parseAsMarkdown, scrollTo, putLinkIndex],
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
      /* `open` reaches the filesystem, and the filesystem can say no after it
         has already said yes: a file that stats fine may still be unreadable,
         or may be removed between the two calls. A rejection here would leave
         React with nothing to render and take the whole viewer down, so a
         failure to follow a link is reported the way every other one is. */
      let next: Awaited<ReturnType<NonNullable<typeof open>>>;
      try {
        next = await open(link.path);
      } catch (err) {
        setStatus(`${link.path}: ${(err as Error).message}`);
        return;
      }
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
    navGeneration.current++;
    onBack?.();
    setSource(prev.source);
    setTitle(prev.title);
    setParseAsMarkdown(prev.markdown);
    putLinkIndex(-1);
    setHOffset(0);
    setPendingOffset(prev.offset);
  }, [putLinkIndex, onBack]);

  /* Reloads are not ordered by the disk. An editor that writes a file twice on
     one save fires two changes, and nothing guarantees the first read resolves
     before the second — so without a generation the older content can land last
     and win, leaving the reader looking at stale text under a "reloaded" note.
     Only the newest reload is allowed to speak. */
  const reloadGeneration = useRef(0);
  /* Bumped by every navigation. The generation above orders reloads against
     each other; this one orders anything slow against the reader having moved
     on. A reload or a highlight build started on one document and resolving
     after a link was followed would otherwise replace the document now on
     screen with the contents of the one left behind. */
  const navGeneration = useRef(0);
  const doReload = useCallback(async () => {
    if (!reload) return;
    const generation = ++reloadGeneration.current;
    const nav = navGeneration.current;
    setStatus('reloading…');
    try {
      const next = await reload();
      if (generation !== reloadGeneration.current || nav !== navGeneration.current) return;
      setSource(next);
      setStatus('reloaded');
    } catch (err) {
      if (generation !== reloadGeneration.current || nav !== navGeneration.current) return;
      setStatus(`could not reload: ${(err as Error).message}`);
    }
  }, [reload]);

  useEffect(() => {
    if (pendingOffset === null) return;
    setPendingOffset(null);
    scrollTo(pendingOffset);
  }, [pendingOffset, doc, scrollTo]);

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
    /* `upgrade` is built once from the document the process opened, so this
       effect never re-runs and its cleanup only fires on unmount. Following a
       link before the grammars finished therefore swapped the document being
       read for a highlighted copy of the one left. */
    const nav = navGeneration.current;
    /* Highlighting is an enhancement on a document that is already readable on
       screen. If building it fails there is nothing to tell the reader and
       nothing to do — but an unhandled rejection would still take the app
       down, so it is swallowed deliberately rather than by omission. */
    void upgrade()
      .then((next) => {
        if (live && nav === navGeneration.current) setSource(next);
      })
      .catch(() => {});
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

  /**
   * The viewport moves, and nothing else. Kept separate from the key handler
   * so a burst of several motion keys can be replayed through it in order.
   */
  const applyMotion = useCallback(
    (motion: string, repeat: number) => {
      switch (motion) {
        case 'j': scrollBy(repeat); return;
        case 'k': scrollBy(-repeat); return;
        case 'd': scrollBy(Math.floor(height / 2) * repeat); return;
        case 'u': scrollBy(-Math.floor(height / 2) * repeat); return;
        case 'f': case ' ': scrollBy((height - 2) * repeat); return;
        case 'b': scrollBy(-(height - 2) * repeat); return;
        case 'g': scrollTo(0); setHOffset(0); return;
        case 'G': scrollTo(doc.lines.length); setHOffset(0); return;
        case 'h': setHOffset((x) => Math.max(0, x - H_STEP * repeat)); return;
        case 'l': setHOffset((x) => Math.min(maxH, x + H_STEP * repeat)); return;
        case '0': setHOffset(0); return;
        default:
      }
    },
    [scrollBy, scrollTo, height, doc.lines.length, maxH],
  );

  /**
   * One keystroke, whether it arrived alone or as part of a chunk.
   *
   * `key` describes the chunk Ink read. When the chunk held several keys it is
   * synthesised per keystroke instead, because Ink's flags describe the whole
   * read — `cat⏎` sets neither `return` nor anything else useful.
   */
  const press = useCallback((input: string, repeat: number, key: Keys) => {
    if (modeRef.current === 'search') {
      if (key.escape) {
        enterMode('doc');
        putQuery(committedRef.current);
        return;
      }
      if (key.return) {
        commitSearch(queryRef.current);
        return;
      }
      if (key.backspace || key.delete) {
        putQuery(queryRef.current.slice(0, -1));
        return;
      }
      /* Only printable text reaches the query. An arrow key or any other
         sequence arrives as raw bytes too, and appending those would type an
         escape sequence into the prompt and search the document for it. */
      if (input && !key.ctrl && !key.meta) {
        const typed = [...input].filter((c) => c >= ' ' && c !== '\u007f').join('');
        if (typed) putQuery(queryRef.current + typed.repeat(repeat));
      }
      return;
    }

    /** Move the link cursor, wrapping, starting from what is on screen. */
    const stepLink = (step: number, times: number) => {
      if (links.length === 0) {
        setStatus('no links in this document');
        return;
      }
      /* With nothing picked yet the first press lands on a link that is on
         screen, and only the presses after it step — so `⇥⇥` selects the
         second link, exactly as two separate presses would. */
      const from =
        linkIndexRef.current >= 0
          ? linkIndexRef.current + step * times
          : (step > 0 ? Math.max(0, links.findIndex((l) => l.row >= offsetRef.current)) : links.length - 1) +
            step * (times - 1);
      const at = ((from % links.length) + links.length) % links.length;
      putLinkIndex(at);
      revealLine(links[at]!.row);
    };
    const followSelected = () => {
      const link = links[linkIndexRef.current];
      if (!link) setStatus('press tab to pick a link first');
      else void follow(link.href);
    };

    if (modeRef.current === 'toc') {
      // q quits from anywhere. An overlay that swallowed it would make the one
      // key everybody already knows mean two different things.
      if (input === 'q') {
        quit();
        return;
      }
      if (key.escape || input === 't') {
        enterMode('doc');
        return;
      }
      /* Read back from the ref, not through a `setTocIndex(i => …)` callback:
         the callback is correct for what is rendered, but the Enter that picks
         a heading reads the index synchronously, and four `j`s and a Return in
         one burst would otherwise all see the index from the last frame. */
      const move = (which: string, by: number) => {
        if (which === 'j') putTocIndex(Math.min(tocIndexRef.current + by, doc.toc.length - 1));
        else if (which === 'k') putTocIndex(Math.max(tocIndexRef.current - by, 0));
        else if (which === 'g') putTocIndex(0);
        else if (which === 'G') putTocIndex(Math.max(0, doc.toc.length - 1));
      };
      const pick = () => {
        enterMode('doc');
        const entry = doc.toc[tocIndexRef.current];
        if (entry) scrollTo(Math.max(0, entry.line - 1));
      };

      if (key.return) {
        pick();
        return;
      }
      if (input === 'j' || key.downArrow) move('j', repeat);
      if (input === 'k' || key.upArrow) move('k', repeat);
      if (input === 'g' || key.pageUp) move('g', repeat);
      if (input === 'G' || key.pageDown) move('G', repeat);
      return;
    }

    if (modeRef.current === 'help') {
      if (input === 'q') quit();
      else enterMode('doc');
      return;
    }

    switch (true) {
      case input === 'q' || key.escape || (key.ctrl && input === 'c'):
        quit();
        return;
      // Motion goes through one place, so a burst and a single press cannot
      // drift apart.
      case input === 'j' || key.downArrow:
        applyMotion('j', repeat);
        return;
      case input === 'k' || key.upArrow:
        applyMotion('k', repeat);
        return;
      case input === 'd' || (key.ctrl && input === 'd'):
        applyMotion('d', repeat);
        return;
      case input === 'u' || (key.ctrl && input === 'u'):
        applyMotion('u', repeat);
        return;
      case input === 'f' || input === ' ' || key.pageDown || (key.ctrl && input === 'f'):
        applyMotion('f', repeat);
        return;
      case input === 'b' || key.pageUp || (key.ctrl && input === 'b'):
        applyMotion('b', repeat);
        return;
      case input === 'h' || key.leftArrow:
        applyMotion('h', repeat);
        return;
      case input === 'l' || key.rightArrow:
        applyMotion('l', repeat);
        return;
      case input === '0':
        applyMotion('0', repeat);
        return;
      case input === 'g':
        applyMotion('g', repeat);
        return;
      case input === 'G':
        applyMotion('G', repeat);
        return;
      case key.tab:
        stepLink(key.shift ? -1 : 1, repeat);
        return;
      case key.return:
        followSelected();
        return;
      case key.backspace || key.delete:
        goBack();
        return;
      case input === '/':
        putQuery('');
        enterMode('search');
        return;
      /* Stepping is by match, not by row. Seeded from the viewport the first
         time, so `n` starts from what the reader is looking at, and by index
         thereafter, so every hit is reachable and none is visited twice. */
      case input === 'n' || input === 'N': {
        /* `matches` is memoised on the *rendered* query. A search committed in
           this same tick has not been rendered yet, so the memo would still be
           the previous query's — and `n` straight after `/cat` and Enter would
           report having nothing to search for while sitting on a match. */
        const live = committedRef.current === committed
          ? matches
          : findMatches(doc.lines, committedRef.current);
        if (live.length === 0) {
          setStatus('nothing to search for yet');
          return;
        }
        const backwards = input === 'N';
        // A held `n` walks that many matches, the same as pressing it that
        // many times — I-15 applies here as much as it does to scrolling.
        let at =
          matchIndexRef.current < 0
            ? nextMatch(live, offsetRef.current, backwards)
            : stepMatch(live, matchIndexRef.current, backwards);
        for (let i = 1; i < repeat; i++) at = stepMatch(live, at, backwards);
        jumpToMatch(at, live);
        return;
      }
      case input === 't':
        putTocIndex(Math.max(0, doc.toc.findIndex((e) => e.line > offsetRef.current) - 1));
        enterMode('toc');
        return;
      case input === '?':
        enterMode('help');
        return;
      case input === 'y': {
        // The block you can see is the block you meant. Several visible, the
        // first — anything cleverer would need a selection the reader has to
        // learn about first.
        const block = doc.code.find((c) => c.to >= offsetRef.current && c.from < offsetRef.current + height);
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
  }, [
    doc, links, offsetRef, height, quit, scrollTo, applyMotion, revealLine, follow, goBack,
    doReload, commitSearch, jumpToMatch, matches, committed, stdout, enterMode, putQuery,
    putLinkIndex, putTocIndex,
  ]);

  /**
   * Pasted text is content, never commands.
   *
   * A chunk of plain characters is otherwise indistinguishable from very fast
   * typing, and the handler replays it as keystrokes — so pasting an ordinary
   * sentence would run every letter of it as a command, and the `q` in "quick"
   * would quit. Bracketed paste is what lets the terminal say which is which;
   * asking for it puts paste on its own channel, and `useInput` then only ever
   * sees keys the reader actually pressed. See I-35.
   */
  usePaste((text) => {
    // In the search box a paste is exactly what the reader wants: a query.
    if (modeRef.current === 'search') {
      const typed = [...text].filter((c) => c >= ' ' && c !== '\u007f').join('');
      if (typed) putQuery(queryRef.current + typed);
      return;
    }
    // Anywhere else there is nothing a document viewer can do with it, and
    // running it as commands is the one thing it must not do.
    setStatus('pasted text ignored — press / to search for it');
  });

  useInput((raw, key) => {
    // Mouse reports reach Ink's key parser too; without this a scroll would
    // register as a burst of keystrokes.
    if (isMouseSequence(raw)) return;

    /* A chunk of ordinary keys is the keystrokes it stands for, applied in
       order — `jjjj`, `jd`, `/cat⏎`, `⇥⏎`, `tjjjj⏎`. Ink cannot split these
       itself: it deliberately leaves `⇥` and `⏎` inside a text run because
       both occur in pasted text, and it has no way to know that `t` means
       something to this app. Doing it here is safe because every value the
       handler branches on is a ref, so a key that changes the mode is visible
       to the key after it. See I-15, I-34. */
    const segments = splitBurst(raw, key);
    if (segments.length === 1 && segments[0]!.key === raw) {
      press(raw, segments[0]!.repeat, key);
      return;
    }
    for (const segment of segments) press(segment.key, segment.repeat, keysFor(segment.key));
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
      /* The row's own width, not the viewport's. `composeFrame` is what clips a
         row to the screen, and it does so *after* this runs — so measuring
         against the viewport here truncated every row wider than it, and in
         `scroll` mode that is exactly the rows a reader pans sideways to read.
         A match near the start of a 200-cell row cut it to 59 and the frame
         went blank; a match past the cut was skipped and the row survived,
         which is why it took a particular query to see it. Only rows carrying a
         match reach this line, so measuring them costs nothing per frame. */
      return highlightRow(row, doc.lines[line]?.plain ?? '', ranges, ansiWidth(row), level);
    },
    [liveMatches, matchIndex, selected, doc, theme, level],
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
    const pane = mode === 'toc' ? tocPane(doc, tocIndex, columns, height, theme, level) : helpPane(columns, height, theme, level);
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
            section: sectionAt(doc, offset),
            state: hOffset > 0 ? `↔ ${hOffset}` : null,
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
