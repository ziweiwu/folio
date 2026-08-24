import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { App, type Source } from '../src/app.js';
import { stripAnsi } from '../src/core/ansi.js';
import { parseArgs } from '../src/core/options.js';
import { pickTheme } from '../src/ui/theme.js';
import { isMouseSequence } from '../src/hooks/useMouse.js';

/**
 * The few behaviours that only exist once the component is running.
 *
 * Everything that can be a pure function is tested as one; this file is for
 * the rest — ordering across awaits, and state that outlives a keystroke.
 */

const theme = pickTheme('dark');

/** The default options, via the public parser rather than a widened export. */
const parsed = parseArgs([]);
if (!parsed.ok) throw new Error(parsed.message);
const options = parsed.options;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Let pending promises and the render they trigger both run to completion. */
/**
 * Let pending promises and the renders they trigger run to completion.
 *
 * Adaptive rather than a fixed wait: it returns as soon as the tree has been
 * quiet for a few ticks, and keeps waiting when the machine is loaded. A fixed
 * sleep either makes every test slow or makes the suite flaky under load, and
 * these tests exist to catch ordering bugs — they must not invent their own.
 */
let live: { lastFrame(): string | undefined } | null = null;

const settle = async () => {
  let previous = live?.lastFrame();
  let quiet = 0;
  for (let tick = 0; tick < 120; tick++) {
    await sleep(5);
    const now = live?.lastFrame();
    if (now === previous) {
      if (++quiet >= 4) return;
    } else {
      quiet = 0;
    }
    previous = now;
  }
};

function mount(props: Partial<Parameters<typeof App>[0]> = {}) {
  const instance = render(
    <App
      initial={{ text: '# Start\n\nv0 original\n' }}
      name="doc.md"
      options={options}
      theme={theme}
      level={0}
      mouse={false}
      overflow="wrap"
      {...props}
    />,
  );
  live = instance;
  return instance;
}

const SECTIONS = Array.from({ length: 40 }, (_, i) =>
  `## Section ${i}\n\n${`prose for section ${i} `.repeat(6)}\n`,
).join('\n');

const setColumns = (n: number) => {
  (process.stdout as unknown as { columns: number }).columns = n;
  process.stdout.emit('resize');
};

describe('I-6 a resize re-anchors the running app, not just the arithmetic', () => {
  /* I-6's other test asserts on `anchorOffset`, which was always correct. The
     defect was in the two effects that feed it: nothing in the suite had ever
     resized a mounted `App`. */
  it('I-6 keeps the reader on the block they were reading', async () => {
    const original = process.stdout.columns;
    const seen: number[] = [];
    try {
      setColumns(120);
      const app = mount({ initial: { text: SECTIONS }, onPosition: (b: number) => seen.push(b) });
      await settle();
      for (let i = 0; i < 30; i++) {
        app.stdin.write('d');
        await settle();
      }
      const before = seen.at(-1)!;
      expect(before).toBeGreaterThan(0);

      setColumns(50);
      await settle();

      /* The recorder used to index the *new* layout with the *old* row number,
         overwrite the anchor with a block the reader had never been on, and the
         re-anchor then went there — and the same wrong block was saved. */
      expect(seen.at(-1)).toBe(before);
      app.unmount();
    } finally {
      (process.stdout as unknown as { columns: number }).columns = original;
    }
  });
});

describe('I-34 the viewport the keystroke before it left', () => {
  const CR = String.fromCharCode(13);

  it('I-34 opens the contents on the heading G jumped to, in one chunk', async () => {
    /* `offset` is state, so for the rest of a chunk it is a frame behind. `G`
       then `t` as separate reads worked; `Gt` in one read selected the heading
       `G` was standing on when the chunk arrived. */
    const app = mount({ initial: { text: SECTIONS } });
    await settle();
    app.stdin.write('Gt');
    await settle();
    app.stdin.write(CR);
    await settle();
    const frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toContain('Section 39');
    expect(frame).not.toContain('Section 0\n');
    app.unmount();
  });
});

const openGuide = async () => ({ source: { text: '# Guide\n\nshort\n' }, name: 'guide.md', markdown: true });

describe('going back restores the place you left', () => {
  /* No test in the suite had ever followed a link that *succeeds*: every
     app-level link test uses an `https://` target, which returns early and
     never reaches `open`, `goTo` or the back stack. */
  const CR = String.fromCharCode(13);
  const TAB = String.fromCharCode(9);
  const BS = String.fromCharCode(127);
  const LINKED = Array.from({ length: 40 }, (_, i) =>
    `## Section ${i}\n\nprose ${i}, see [guide](guide.md) for more.\n`,
  ).join('\n');

  it('restores the offset when the document returned to is longer than the one left', async () => {
    const seen: number[] = [];
    const app = mount({ initial: { text: LINKED }, open: openGuide, onPosition: (b: number) => seen.push(b) });
    await settle();

    for (let i = 0; i < 20; i++) {
      app.stdin.write('d');
      await settle();
    }
    app.stdin.write(TAB);
    await settle();
    /* After the reveal, not before it: picking a link scrolls it into view, and
       the back stack remembers where the follow was made from. */
    const before = seen.at(-1)!;
    expect(before).toBeGreaterThan(0);

    app.stdin.write(CR);
    await settle();
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('Guide');

    app.stdin.write(BS);
    await settle();

    /* `goBack` restored the offset from the key handler, where the scroll
       limits still described the short document being left — so coming back to
       a longer one clamped the offset to its end, which for a 3-row document
       is 0, and the reader was dropped at the top of what they had read. */
    const frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).not.toContain('Section 0');
    expect(seen.at(-1)).toBe(before);
    app.unmount();
  });
});

describe('I-23 copying is reported as sent, never as copied', () => {
  it('I-23 says sent, because OSC 52 is advisory', async () => {
    /* The terminal may silently refuse the sequence, so the message must not
       claim more than actually happened. This was listed as script-enforced and
       no script mentioned it; the one test that carried the string supplied it
       to `statusBar` itself, so it would have passed had the app said
       "copied". */
    const app = mount({ initial: { text: '# doc\n\n```js\nconst a = 1;\n```\n' } });
    await settle();
    app.stdin.write('y');
    await settle();
    const frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toMatch(/sent \d+ lines? to the clipboard/);
    expect(frame).not.toContain('copied');
    app.unmount();
  });
});

describe('I-33 a navigation invalidates work started before it', () => {
  const CR = String.fromCharCode(13);
  const TAB = String.fromCharCode(9);
  const LINKED = '# A\n\nsee [guide](guide.md) for more.\n';

  it('I-33 discards a reload that finishes after a link was followed', async () => {
    /* The generation orders reloads against each other, but nothing invalidated
       one against the reader moving on — so a reload started on A and resolving
       after a link to B replaced B with A's text, under a "reloaded" note. */
    const pending: Array<(s: Source) => void> = [];
    let fire: (() => void) | null = null;
    const app = mount({
      initial: { text: LINKED },
      open: openGuide,
      reload: () => new Promise<Source>((resolve) => pending.push(resolve)),
      watch: (onChange) => {
        fire = onChange;
        return () => {};
      },
    });
    await settle();

    fire!();
    await settle();
    expect(pending).toHaveLength(1);

    app.stdin.write(TAB);
    await settle();
    app.stdin.write(CR);
    await settle();
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('Guide');

    // The read of A lands only now, with B on screen.
    pending[0]!({ text: '# A\n\nA reloaded from disk\n' });
    await settle();

    const frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toContain('Guide');
    expect(frame).not.toContain('A reloaded from disk');
    app.unmount();
  });

  it('I-33 discards a highlight build that finishes after a link was followed', async () => {
    /* `upgrade` is built once from the document the process opened, so its
       effect never re-runs and its cleanup only fires on unmount. */
    let settleUpgrade: ((s: Source) => void) | null = null;
    const app = mount({
      initial: { text: LINKED },
      open: openGuide,
      upgrade: () => new Promise<Source>((resolve) => { settleUpgrade = resolve; }),
    });
    await settle();

    app.stdin.write(TAB);
    await settle();
    app.stdin.write(CR);
    await settle();
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('Guide');

    settleUpgrade!({ text: '# A\n\nA highlighted\n' });
    await settle();

    const frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toContain('Guide');
    expect(frame).not.toContain('A highlighted');
    app.unmount();
  });
});

describe('I-33 only the newest reload may change the document', () => {
  it('I-33 discards a slow reload that a later one has already superseded', async () => {
    /* An editor that writes a file twice on one save fires two change events,
       and nothing orders their reads. Without a generation the first, slowest
       read lands last and wins — showing stale text under a "reloaded" note.

       The reads are resolved by hand rather than by racing timers, so the
       ordering under test is the one written here and not one the machine's
       load decided. */
    const pending: Array<(s: Source) => void> = [];
    const reload = () => new Promise<Source>((resolve) => pending.push(resolve));

    let fire: (() => void) | null = null;
    const app = mount({
      reload,
      watch: (onChange) => {
        fire = onChange;
        return () => {};
      },
    });
    await settle();

    fire!();
    fire!();
    fire!();
    await settle();
    expect(pending, 'three changes should have started three reads').toHaveLength(3);

    // The newest read finishes first, the oldest last — the losing order.
    pending[2]!({ text: '# Start\n\nv3 final\n' });
    await settle();
    pending[1]!({ text: '# Start\n\nv2\n' });
    await settle();
    pending[0]!({ text: '# Start\n\nv1 slow\n' });
    await settle();

    const frame = app.lastFrame() ?? '';
    expect(frame).toContain('v3 final');
    expect(frame).not.toContain('v1 slow');
    expect(frame).not.toContain('v2');
    app.unmount();
  });

  it('I-33 still shows the content when reloads resolve in order', async () => {
    let call = 0;
    let fire: (() => void) | null = null;
    const app = mount({
      watch: (onChange) => {
        fire = onChange;
        return () => {};
      },
      reload: async (): Promise<Source> => ({ text: `# Start\n\nreloaded ${++call}\n` }),
    });
    await sleep(50);
    fire!();
    await sleep(200);
    expect(app.lastFrame() ?? '').toContain('reloaded 1');
    app.unmount();
  });

  it('I-33 reports a failed reload without replacing the document', async () => {
    const app = mount({
      watch: (onChange) => {
        onChange();
        return () => {};
      },
      reload: async (): Promise<Source> => {
        throw new Error('gone');
      },
    });
    await sleep(200);
    const frame = app.lastFrame() ?? '';
    // The document the reader had is still there, and they are told why.
    expect(frame).toContain('v0 original');
    expect(frame).toContain('gone');
    app.unmount();
  });
});

describe('I-15 a search can arrive in a single read', () => {
  /* `/cat` typed fast, or pasted, reaches the handler as one string. It used
     to match no case at all and vanish, so pasting a search term was
     indistinguishable from pressing nothing. */
  const DOC = '# Doc\n\nalpha beta\n\nthe cat sat\n\nmore cat here\n';

  it('I-15 runs a pasted query that ends with Enter', async () => {
    const app = mount({ initial: { text: DOC } });
    await settle();
    app.stdin.write('/cat\r');
    await settle();
    const frame = app.lastFrame() ?? '';
    // Back in the document, not sitting in the prompt.
    expect(frame).not.toContain('/cat');
    expect(stripAnsi(frame)).toContain('the cat sat');
    app.unmount();
  });

  it('I-15 leaves a pasted query without Enter in the prompt', async () => {
    const app = mount({ initial: { text: DOC } });
    await settle();
    app.stdin.write('/cat');
    await settle();
    // The prompt is open with the text in it, waiting to be committed.
    expect(app.lastFrame() ?? '').toContain('/cat');
    app.unmount();
  });

  it('I-15 treats a repeated slash as a key repeat, not a query of slashes', async () => {
    // `//` lands in one read when the key repeats. It opens an empty prompt,
    // the way one `/` does — not a search for "/".
    for (const keys of ['//', '///']) {
      const app = mount({ initial: { text: DOC } });
      await settle();
      app.stdin.write(keys);
      await settle();
      const bar = (app.lastFrame() ?? '').split('\n').at(-1) ?? '';
      expect(bar, keys).toContain('/');
      expect(bar, keys).not.toContain('//');
      app.unmount();
    }
  }, 30_000);

  it('I-15 says so when a pasted query matches nothing', async () => {
    const app = mount({ initial: { text: DOC } });
    await settle();
    app.stdin.write('/zebra\r');
    await settle();
    expect(app.lastFrame() ?? '').toContain('no match');
    app.unmount();
  });

  it('I-15 never types an escape sequence into the query', async () => {
    /* An arrow key reaches the handler as raw bytes like any other input.
       Appending those verbatim would put an escape sequence in the prompt and
       search the document for it. */
    const app = mount({ initial: { text: DOC } });
    await settle();
    app.stdin.write('/ca' + String.fromCharCode(27) + '[At');
    await settle();
    const frame = app.lastFrame() ?? '';
    expect(frame).not.toContain('[A');
    expect(frame).not.toContain(String.fromCharCode(27) + '[A');
    app.unmount();
  });

});

describe('I-34 a keystroke sees the mode the one before it chose', () => {
  /* Two keystrokes can land in the same tick, before React has re-rendered.
     Read from state, the handler then branches on the mode it had *last frame*
     — so `/cat` followed immediately by `q` was evaluated as `doc` mode and
     quit the viewer instead of typing a `q` into the search box. */
  const DOC = '# Doc\n\nalpha beta\n\nthe cat sat\n\nmore cat\n';

  it('I-34 types into the search box rather than quitting', async () => {
    const app = mount({ initial: { text: DOC } });
    await settle();
    app.stdin.write('/cat');
    app.stdin.write('q'); // same tick, before any re-render
    await settle();
    const frame = app.lastFrame() ?? '';
    // Still running, and the `q` went into the query.
    expect(frame).not.toBe('');
    expect(frame).toContain('/catq');
    app.unmount();
  });

  it('I-34 keeps a query typed across several writes in one tick', async () => {
    const app = mount({ initial: { text: DOC } });
    await settle();
    app.stdin.write('/');
    app.stdin.write('cat');
    app.stdin.write('\r');
    await settle();
    const frame = app.lastFrame() ?? '';
    // Committed and found something, rather than searching for the empty string.
    expect(frame).not.toContain('no match');
    expect(stripAnsi(frame)).toContain('the cat sat');
    app.unmount();
  });

  it('I-34 leaves a mode as promptly as it enters one', async () => {
    const app = mount({ initial: { text: DOC } });
    await settle();
    // Open the contents, close it, then a motion key — all in one tick. The
    // motion must reach the document, not the closed overlay.
    app.stdin.write('t');
    app.stdin.write('t');
    app.stdin.write('G');
    await settle();
    const frame = app.lastFrame() ?? '';
    expect(frame).not.toContain('Contents');
    app.unmount();
  });

  it('I-34 steps through matches pressed faster than a render', async () => {
    const app = mount({ initial: { text: DOC } });
    await settle();
    app.stdin.write('/cat\r');
    await settle();
    // Two `n` in one tick must advance twice, not twice to the same match.
    app.stdin.write('n');
    app.stdin.write('n');
    await settle();
    expect(app.lastFrame() ?? '').not.toBe('');
    app.unmount();
  });
});

const HEADINGS = Array.from({ length: 10 }, (_unused, i) =>
  `# Heading ${i}\n\n${Array.from({ length: 6 }, (_body, j) => `Body ${j} of ${i}.`).join('\n\n')}\n\n`,
).join('');

/** The heading at the top of the viewport after a selection. */
function topHeading(frame: string): string | null {
  return /Heading (\d)/.exec(frame)?.[1] ?? null;
}

describe('I-34 the contents pane answers a burst too', () => {
  /* A held `j` and a quick Return land in one read. The burst matches no
     single key, so it used to be dropped whole — the reader pressed five keys
     and stayed exactly where they were, with nothing to say why. */

  it('I-34 applies navigation and the Return that arrived with it', async () => {
    const app = mount({ initial: { text: HEADINGS } });
    await settle();
    app.stdin.write('t');
    await settle();
    app.stdin.write('jjjj\r');
    await settle();
    const frame = app.lastFrame() ?? '';
    expect(frame).not.toContain('Contents');
    expect(topHeading(frame)).toBe('4');
    app.unmount();
  });

  it('I-34 reaches the same place however the burst is split', async () => {
    for (const writes of [['jjjj\r'], ['jjjj', '\r'], ['j', 'j', 'j', 'j', '\r'], ['jj', 'kj', 'j', 'j\r']]) {
      const app = mount({ initial: { text: HEADINGS } });
      await settle();
      app.stdin.write('t');
      await settle();
      for (const w of writes) app.stdin.write(w);
      await settle();
      const got = topHeading(app.lastFrame() ?? '');
      // The last case nets +4 as well: j,j,k,j,j,j.
      expect(got, JSON.stringify(writes)).toBe('4');
      app.unmount();
    }
  }, 30_000);

  it('I-34 honours g and G arriving with a Return', async () => {
    for (const [keys, want] of [['G\r', '9'], ['jjjG\r', '9'], ['jjjg\r', '0']] as const) {
      const app = mount({ initial: { text: HEADINGS } });
      await settle();
      app.stdin.write('t');
      await settle();
      app.stdin.write(keys);
      await settle();
      expect(topHeading(app.lastFrame() ?? ''), keys).toBe(want);
      app.unmount();
    }
  }, 30_000);

  it('I-34 lets q quit from the contents, including from a chunk', async () => {
    /* `q` quits from anywhere, and a chunk means the keys it spells — so `tq`
       opens the contents and quits from them, exactly as pressing the two keys
       does. A blank frame is this renderer's signature for an unmounted app. */
    const stepwise = mount({ initial: { text: HEADINGS } });
    await settle();
    stepwise.stdin.write('t');
    await settle();
    expect(stepwise.lastFrame() ?? '').toContain('Contents');
    stepwise.stdin.write('q');
    await settle();
    expect((stepwise.lastFrame() ?? '').trim()).toBe('');
    stepwise.unmount();

    const chunked = mount({ initial: { text: HEADINGS } });
    await settle();
    chunked.stdin.write('tq');
    await settle();
    expect((chunked.lastFrame() ?? '').trim()).toBe('');
    chunked.unmount();
  });
});

describe('I-34 Tab and Return arriving together', () => {
  /* Ink splits a held *backspace* out of a chunk but deliberately does not
     split Tab or Return, because both can appear inside pasted text. So `⇥⏎`
     is a single chunk that sets neither `key.tab` nor `key.return` — it used
     to match no case and vanish, taking the reader's attempt to follow a link
     with it. */
  const LINKS =
    '# doc\n\nOne [a](https://a.example) two [b](https://b.example) three [c](https://c.example).\n';
  const CR = String.fromCharCode(13);
  const TAB = String.fromCharCode(9);

  it('I-34 follows a link when Tab and Return share a read', async () => {
    const app = mount({ initial: { text: LINKS } });
    await settle();
    app.stdin.write(TAB + CR);
    await settle();
    expect(app.lastFrame() ?? '').toContain('https://a.example');
    app.unmount();
  });

  it('I-34 counts every Tab in the burst', async () => {
    for (const [keys, want] of [
      [TAB + CR, 'a'],
      [TAB + TAB + CR, 'b'],
      [TAB + TAB + TAB + CR, 'c'],
    ] as const) {
      const app = mount({ initial: { text: LINKS } });
      await settle();
      app.stdin.write(keys);
      await settle();
      expect(app.lastFrame() ?? '', `${keys.length} keys`).toContain(`https://${want}.example`);
      app.unmount();
    }
  }, 30_000);

  it('I-34 lands a burst where the same keys pressed singly would', async () => {
    const burst = mount({ initial: { text: LINKS } });
    await settle();
    burst.stdin.write(TAB + TAB);
    await settle();
    burst.stdin.write(CR);
    await settle();
    const fromBurst = burst.lastFrame() ?? '';
    burst.unmount();

    const singly = mount({ initial: { text: LINKS } });
    await settle();
    for (const k of [TAB, TAB, CR]) {
      singly.stdin.write(k);
      await settle();
    }
    expect(fromBurst).toContain('https://b.example');
    expect(singly.lastFrame() ?? '').toContain('https://b.example');
    singly.unmount();
  });

  it('I-34 still says so when Return arrives with nothing picked', async () => {
    const app = mount({ initial: { text: LINKS } });
    await settle();
    app.stdin.write(CR);
    await settle();
    expect(app.lastFrame() ?? '').toContain('press tab to pick a link first');
    app.unmount();
  });

  it('I-34 commits a query typed into an open box in one read', async () => {
    /* The `/query⏎` shortcut only covers the burst that *opens* the box. Once
       it is open, `key.return` is the only commit path, and Ink sets that only
       when the chunk is exactly `\r` — so typing fast left the search sitting
       there, matched but never run. */
    const app = mount({ initial: { text: '# doc\n\nthe cat sat\n' } });
    await settle();
    app.stdin.write('/');
    await settle();
    app.stdin.write('cat' + CR);
    await settle();
    const frame = app.lastFrame() ?? '';
    expect(frame).not.toContain('/cat');
    expect(stripAnsi(frame)).toContain('the cat sat');
    app.unmount();
  });
});

describe('I-34 a chunk means the keystrokes it spells', () => {
  /* The last of five places this class of bug turned up. Rather than a fifth
     special case, a chunk of ordinary keys is now split back into keystrokes
     and applied in order — which only works because every value the handler
     branches on is a ref, so `t` opening the contents is visible to the `j`
     after it in the same chunk. */
  const CR = String.fromCharCode(13);

  it('I-34 opens the contents and acts in it from one chunk', async () => {
    const app = mount({ initial: { text: HEADINGS } });
    await settle();
    app.stdin.write(`tjjjj${CR}`);
    await settle();
    const frame = app.lastFrame() ?? '';
    expect(frame).not.toContain('Contents');
    expect(topHeading(frame)).toBe('4');
    app.unmount();
  });

  it('I-34 gets the same result however the chunk is split', async () => {
    const runs: string[][] = [
      [`tjjjj${CR}`],
      ['t', `jjjj${CR}`],
      ['t', 'jjjj', CR],
      ['t', 'j', 'j', 'j', 'j', CR],
      [`tjjkjjj${CR}`],
    ];
    for (const writes of runs) {
      const app = mount({ initial: { text: HEADINGS } });
      await settle();
      for (const w of writes) {
        app.stdin.write(w);
        await settle();
      }
      expect(topHeading(app.lastFrame() ?? ''), JSON.stringify(writes)).toBe('4');
      app.unmount();
    }
  }, 30_000);

  it('I-34 treats a held key as one press, not as a toggle', async () => {
    /* A run of the same key is key repeat, and `t` is a toggle — collapsing
       the run is what stops a held `t` opening and closing the contents over
       and over. Two *different* keys in a chunk are two keystrokes; the same
       key twice is one. */
    const app = mount({ initial: { text: HEADINGS } });
    await settle();
    app.stdin.write('tt');
    await settle();
    expect(app.lastFrame() ?? '').toContain('Contents');
    app.unmount();
  });

  it('I-34 closes the contents when a second, separate press arrives', async () => {
    const app = mount({ initial: { text: HEADINGS } });
    await settle();
    app.stdin.write('t');
    await settle();
    expect(app.lastFrame() ?? '').toContain('Contents');
    app.stdin.write('t');
    await settle();
    expect(app.lastFrame() ?? '').not.toContain('Contents');
    app.unmount();
  });

  it('I-34 never splits an escape sequence into its bytes', async () => {
    /* An arrow is one keypress spelled in several bytes. Split, its `[` and
       `A` would be typed as text — so a chunk carrying one is handed to Ink's
       own parse of it instead. */
    const app = mount({ initial: { text: HEADINGS } });
    await settle();
    app.stdin.write('/');
    await settle();
    app.stdin.write(String.fromCharCode(27) + '[A');
    await settle();
    const bar = (app.lastFrame() ?? '').split('\n').at(-1) ?? '';
    expect(bar).not.toContain('[A');
    app.unmount();
  });
});

describe('I-15 a held key walks that many steps', () => {
  const CR = String.fromCharCode(13);
  const MANY = `# D\n\n${'alpha one\n\nalpha two\n\nalpha three\n\nalpha four\n\n'}`;

  it('I-15 advances one match per n in the chunk', async () => {
    /* `nn` is two presses of `n`, so it walks two matches. The repeat count is
       not decoration — the same rule that makes `jjjj` four lines. */
    const one = mount({ initial: { text: MANY } });
    await settle();
    one.stdin.write(`/alpha${CR}`);
    await settle();
    one.stdin.write('n');
    await settle();
    one.stdin.write('n');
    await settle();
    const separately = one.lastFrame() ?? '';
    one.unmount();

    const burst = mount({ initial: { text: MANY } });
    await settle();
    burst.stdin.write(`/alpha${CR}`);
    await settle();
    burst.stdin.write('nn');
    await settle();
    expect(burst.lastFrame() ?? '').toBe(separately);
    burst.unmount();
  });
});

describe('I-35 pasted text is content, never commands', () => {
  /* A chunk of plain characters is otherwise indistinguishable from very fast
     typing, so the handler would replay a pasted sentence as commands and the
     `q` in "quick" would quit the viewer. Bracketed paste is what lets the
     terminal say which is which. */
  const ESC = String.fromCharCode(27);
  const bracket = (text: string) => `${ESC}[200~${text}${ESC}[201~`;
  const DOC = `# doc\n\n${Array.from({ length: 40 }, (_x, i) => `line ${i}`).join('\n\n')}\n`;

  it('I-35 survives a paste containing every command key', async () => {
    for (const pasted of [
      'the quick brown fox jumps over the lazy dog',
      'npm install --save-dev typescript',
      'git commit -m fix',
      'SELECT * FROM users WHERE id = 1;',
    ]) {
      const app = mount({ initial: { text: DOC } });
      await settle();
      app.stdin.write(bracket(pasted));
      await settle();
      // Still running, and it says what it did with the paste.
      expect(app.lastFrame() ?? '', pasted).not.toBe('');
      expect(app.lastFrame() ?? '', pasted).toContain('pasted text ignored');
      app.unmount();
    }
  }, 30_000);

  it('I-35 takes a paste into an open search box as the query', async () => {
    const app = mount({ initial: { text: DOC } });
    await settle();
    app.stdin.write('/');
    await settle();
    app.stdin.write(bracket('line 12'));
    await settle();
    expect(app.lastFrame() ?? '').toContain('/line 12');
    app.unmount();
  });

  it('I-35 still runs keys the reader actually pressed', async () => {
    // The paste channel must not swallow ordinary input.
    const app = mount({ initial: { text: DOC } });
    await settle();
    app.stdin.write('G');
    await settle();
    expect(app.lastFrame() ?? '').toContain('100%');
    app.unmount();
  });
});

describe('I-37 there is always a way out', () => {
  /* Ctrl-C is what a reader falls back on when they do not know an app, and
     Ink is deliberately told not to act on it (`exitOnCtrlC: false`) so that a
     `c` typed into the search box is never mistaken for it. That put the whole
     decision on this component — and it was only ever made in the doc branch,
     so `/` or `t` and then Ctrl-C did nothing at all. The two modes it was
     dead in were exactly the two a reader can get stuck in: a full-screen pane
     and a prompt. A blank frame is this renderer's signature for an unmounted
     app, the same signal the `q`-from-the-contents test uses. */
  const CTRL_C = '\x03';

  it.each([
    ['the document', ''],
    ['the search prompt', '/'],
    ['a half-typed query', '/cat'],
    ['the contents', 't'],
    ['the help pane', '?'],
  ])('I-37 ctrl-c quits from %s', async (_what, opener) => {
    const app = mount({ initial: { text: SECTIONS } });
    await settle();
    if (opener !== '') {
      app.stdin.write(opener);
      await settle();
      expect(app.lastFrame() ?? '').not.toBe('');
    }
    app.stdin.write(CTRL_C);
    await settle();
    expect((app.lastFrame() ?? '').trim()).toBe('');
    app.unmount();
  }, 30_000);

  it('I-37 does not mistake a c typed into the query for it', async () => {
    // The reason Ink is not allowed to handle Ctrl-C itself in the first place.
    const app = mount({ initial: { text: SECTIONS } });
    await settle();
    app.stdin.write('/cc');
    await settle();
    expect(app.lastFrame() ?? '').toContain('/cc');
    app.unmount();
  });
});

/** The sideways offset the status bar is currently advertising, or 0. */
const shiftOf = (frame: string) => Number(/↔ (\d+)/.exec(frame)?.[1] ?? 0);

describe('I-36 the sideways offset follows the rows on screen', () => {
  /* `maxHOffset` is a property of the rows in the viewport, so it shrinks as
     the reader scrolls while the offset they panned to does not. Panning right
     over a 300-cell block and scrolling down to a 60-cell one sliced every row
     from a column past its end: the block rendered blank, with a `‹` and no
     `›` — nothing did continue rightwards — so there was no mark to say the
     content was elsewhere and no clue which key would bring it back.

     Scrolled with `j` rather than `G`, which resets the offset to zero and so
     cannot reproduce anything. The filler is longer than a viewport on purpose:
     the two blocks have to be on separate screens, or the wider one is still
     granting the reach that the narrower one is being sliced against. */
  const FILLER = Array.from({ length: 40 }, (_, i) => `filler paragraph ${i}\n`).join('\n');
  const BLOCKS = [
    '```sh',
    `${'A'.repeat(300)} tail-of-the-wide-one`,
    '```',
    '',
    FILLER,
    '```sh',
    `${'B'.repeat(60)} tail-of-the-narrow-one`,
    '```',
    '',
  ].join('\n');

  const panThenScroll = async () => {
    const app = mount({ initial: { text: BLOCKS }, overflow: 'scroll' });
    await settle();
    app.stdin.write('l'.repeat(60));
    await settle();
    const panned = stripAnsi(app.lastFrame() ?? '');
    for (let i = 0; i < 12; i++) {
      app.stdin.write('d');
      await settle();
    }
    return { app, panned, landed: stripAnsi(app.lastFrame() ?? '') };
  };

  it('I-36 keeps a narrower block readable after panning over a wider one', async () => {
    const { app, panned, landed } = await panThenScroll();
    // The pan really did move, or the rest of this proves nothing.
    expect(panned).toContain('↔');
    expect(landed).toContain('tail-of-the-narrow-one');
    app.unmount();
  }, 30_000);

  it('I-36 never reports a shift the rows on screen cannot reach', async () => {
    const { app, panned, landed } = await panThenScroll();
    expect(shiftOf(panned)).toBeGreaterThan(0);
    /* The bar's `↔` is what tells a reader the `›` on a row is something `l`
       can reach (I-26). Left at the wide block's figure it promised a shift
       that no longer existed. */
    expect(shiftOf(landed)).toBeLessThan(shiftOf(panned));
    app.unmount();
  }, 30_000);
});

describe('I-15 a mouse report is skipped, and nothing else is', () => {
  /* Mouse reports reach Ink's key parser as well as the raw stream, so the key
     handler has to recognise and skip them — and Ink strips a leading ESC from
     anything it could not parse, so it cannot rely on the escape being there.
     Recognising them by the bare `[<` introducer made the filter match plain
     text: `useInput` drops the *whole chunk* a report is found in, so typing
     `[<` fast enough to land in one read swallowed those two keys and every
     other key in the chunk with them, silently. See src/hooks/useMouse.ts. */
  it('I-15 skips a real SGR report, with or without its escape', () => {
    expect(isMouseSequence('\x1b[<64;10;5M')).toBe(true);
    expect(isMouseSequence('[<64;10;5M')).toBe(true);
    expect(isMouseSequence('[<0;1;1m')).toBe(true);
    // Several batched into one read is still a read of mouse reports.
    expect(isMouseSequence('[<64;10;5M[<64;10;6M')).toBe(true);
  });

  it('I-15 does not take ordinary text for a mouse report', () => {
    for (const typed of ['[<', 'a[<b', '[<T>', 'Array[<T>]', 'j[<k', '[<;;M']) {
      expect(isMouseSequence(typed), typed).toBe(false);
    }
  });

  it('I-15 types "[<" into the query instead of dropping the burst', async () => {
    const app = mount({ initial: { text: '# D\n\nsome [<T> text\n' } });
    await settle();
    app.stdin.write('/');
    await settle();
    // One read, the way key repeat or a coalesced read delivers it.
    app.stdin.write('[<T');
    await settle();
    expect(app.lastFrame() ?? '').toContain('/[<T');
    app.unmount();
  });

  it('I-15 still ignores a wheel report arriving as keys', async () => {
    const app = mount({ initial: { text: SECTIONS } });
    await settle();
    const before = app.lastFrame() ?? '';
    app.stdin.write('\x1b[<65;10;5M');
    await settle();
    // Skipped, not replayed as the keystrokes `[`, `<`, `6`, `5`, … — `5` is
    // nothing, but `M` and `m` would be, and the digits would not scroll.
    expect(app.lastFrame() ?? '').toBe(before);
    app.unmount();
  });
});

describe('a search says where you are in it', () => {
  /* The count is shown while the query is being typed and then vanished the
     moment it was committed — exactly when it starts to matter. `n` moved the
     viewport and said nothing, so there was no way to tell three matches from
     thirty, or to notice the wrap from the last back to the first. */
  const REPEATED = Array.from({ length: 5 }, (_, i) => `## Section ${i}\n\nthe needle is here\n`).join('\n');
  const CR = String.fromCharCode(13);

  it('reports which match, out of how many, on committing', async () => {
    const app = mount({ initial: { text: REPEATED } });
    await settle();
    app.stdin.write('/needle');
    await settle();
    app.stdin.write(CR);
    await settle();
    expect(app.lastFrame() ?? '').toContain('of 5');
    app.unmount();
  });

  it('counts up as n steps, and wraps back to the first', async () => {
    const app = mount({ initial: { text: REPEATED } });
    await settle();
    app.stdin.write('/needle');
    await settle();
    app.stdin.write(CR);
    await settle();
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      app.stdin.write('n');
      await settle();
      seen.push(/match (\d+) of (\d+)/.exec(app.lastFrame() ?? '')?.[0] ?? 'none');
    }
    // Five matches, five presses: every one is named and the cycle closes.
    expect(new Set(seen).size).toBe(5);
    expect(seen.at(-1)).toBe('match 1 of 5');
    app.unmount();
  }, 30_000);

  it('still says so when there is nothing to find', async () => {
    /* A short query on purpose: `/haystack` is nine different keys in one read
       and the paste guard refuses it (I-35), which is correct and is not what
       this test is about. */
    const app = mount({ initial: { text: REPEATED } });
    await settle();
    app.stdin.write('/zzz');
    await settle();
    app.stdin.write(CR);
    await settle();
    expect(app.lastFrame() ?? '').toContain('no match for "zzz"');
    app.unmount();
  });
});

/** An `open` that gets as far as reading and is then refused by the filesystem. */
const denied = async () => {
  throw new Error("EACCES: permission denied, open '/x/secret.md'");
};

describe('I-34 Enter is Enter however the terminal spells it', () => {
  /* Ink calls `\r` a return and a lone `\n` an *enter*, and only the first
     sets `key.return` — the second arrives with every flag false and its input
     blanked. A pty whose line discipline translates CR to NL, which is what a
     terminal does until raw mode turns it off, therefore delivered an Enter
     this app matched against nothing and silently dropped. It cost a CI run
     that reported the viewer as saying nothing when it had in fact been asked
     nothing: Tab selects a link without a word, so a dead Enter after it
     produces no message at all, which is the one outcome that looks like the
     app being broken rather than the keystroke being lost. */
  const LINKED = '# Main\n\nGo to [secret](./secret.md) now.\n';

  it.each([
    ['a carriage return', '\r'],
    ['a newline', '\n'],
  ])('I-34 follows a picked link on %s', async (_what, enter) => {
    const app = mount({ initial: { text: LINKED }, open: denied });
    await settle();
    app.stdin.write('\t');
    await settle();
    app.stdin.write(enter);
    await settle();
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('permission denied');
    app.unmount();
  }, 30_000);

  it.each([
    ['a carriage return', '\r'],
    ['a newline', '\n'],
  ])('I-34 commits a typed query on %s', async (_what, enter) => {
    const app = mount({ initial: { text: SECTIONS } });
    await settle();
    app.stdin.write('/');
    await settle();
    app.stdin.write('prose');
    await settle();
    app.stdin.write(enter);
    await settle();
    // Committed, so the prompt is gone and the match count is reported.
    const frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toContain('of ');
    expect(frame).not.toContain('/prose▏');
    app.unmount();
  }, 30_000);

  it('I-34 still reports nothing to follow when no link is picked', async () => {
    // The newline must mean Enter, not be swallowed into meaning nothing.
    const app = mount({ initial: { text: LINKED }, open: denied });
    await settle();
    app.stdin.write('\n');
    await settle();
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('press tab to pick a link first');
    app.unmount();
  });
});

describe('I-31 a host callback that rejects becomes a message, not a crash', () => {
  /* `stat` succeeding does not mean a file can be read, so `open` may reject
     after the viewer has committed to the navigation — and a rejection React
     cannot render takes the whole viewer down with a blank screen. Guarded in
     a real pty as well (scripts/pty-link.py), but that needs a terminal and a
     file the filesystem will refuse; this needs neither, so it runs everywhere
     and on every commit. */
  const LINKED_DOC = '# Main\n\nGo to [secret](./secret.md) now.\n';

  it('I-31 reports a rejected open and keeps drawing', async () => {
    const app = mount({ initial: { text: LINKED_DOC }, open: denied });
    await settle();
    app.stdin.write('\t');
    await settle();
    app.stdin.write('\r');
    await settle();
    const frame = stripAnsi(app.lastFrame() ?? '');
    expect(frame).toContain('permission denied');
    // Still a viewer: the help pane only draws if something is alive to draw it.
    app.stdin.write('?');
    await settle();
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('reload from disk');
    app.unmount();
  }, 30_000);

  it('I-31 reports a target that resolves to nothing', async () => {
    const app = mount({ initial: { text: LINKED_DOC }, open: async () => null });
    await settle();
    app.stdin.write('\t');
    await settle();
    app.stdin.write('\r');
    await settle();
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('not found');
    app.unmount();
  }, 30_000);

  it('I-31 says so rather than throwing when there is nowhere to open from', async () => {
    // Reading stdin: "relative to the current document" has no meaning.
    const app = mount({ initial: { text: LINKED_DOC } });
    await settle();
    app.stdin.write('\t');
    await settle();
    app.stdin.write('\r');
    await settle();
    expect(stripAnsi(app.lastFrame() ?? '')).toContain('cannot follow a file link');
    app.unmount();
  }, 30_000);
});
