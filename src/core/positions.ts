/**
 * Where you had got to in each file.
 *
 * The stored position is a **block index**, not a row: rows depend on the
 * terminal's width, so a position saved in a wide window would land somewhere
 * else entirely when reopened in a narrow one. Blocks are a property of the
 * document, so they survive.
 *
 * Pure, so the format and its pruning can be tested without touching disk.
 */

export type Positions = {
  version: 1;
  entries: Record<string, { block: number; at: number }>;
};

/** Enough to cover what anyone is actually reading, small enough to stay fast. */
export const MAX_ENTRIES = 200;

export const EMPTY: Positions = { version: 1, entries: {} };

/**
 * A corrupt or unreadable store is not an error worth reporting: this is a
 * convenience, and losing it costs the reader one keypress.
 */
export function parsePositions(raw: string): Positions {
  try {
    const parsed = JSON.parse(raw) as Partial<Positions>;
    if (parsed?.version !== 1 || typeof parsed.entries !== 'object' || parsed.entries === null) {
      return EMPTY;
    }
    const entries: Positions['entries'] = {};
    for (const [path, value] of Object.entries(parsed.entries)) {
      const block = (value as { block?: unknown })?.block;
      const at = (value as { at?: unknown })?.at;
      if (typeof block === 'number' && Number.isFinite(block) && block >= 0) {
        entries[path] = { block: Math.floor(block), at: typeof at === 'number' ? at : 0 };
      }
    }
    return { version: 1, entries };
  } catch {
    return EMPTY;
  }
}

/** Record a position, evicting the least recently read entries past the cap. */
export function remember(store: Positions, path: string, block: number, now: number): Positions {
  const entries = { ...store.entries, [path]: { block: Math.max(0, Math.floor(block)), at: now } };
  const paths = Object.keys(entries);
  if (paths.length <= MAX_ENTRIES) return { version: 1, entries };

  const keep = paths
    .toSorted((a, b) => (entries[b]!.at - entries[a]!.at) || a.localeCompare(b))
    .slice(0, MAX_ENTRIES);
  const pruned: Positions['entries'] = {};
  for (const p of keep) pruned[p] = entries[p]!;
  return { version: 1, entries: pruned };
}

/** The remembered block for a file, or null if it has not been read before. */
export function recall(store: Positions, path: string): number | null {
  const entry = store.entries[path];
  return entry ? entry.block : null;
}

export function forget(store: Positions, path: string): Positions {
  if (!(path in store.entries)) return store;
  const entries = { ...store.entries };
  delete entries[path];
  return { version: 1, entries };
}
