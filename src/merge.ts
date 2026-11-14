import type { VaultData } from './types';

// Same algorithm as electron/merge.cjs — keep them in sync.
const TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000;

type Stamped = { id: string; updatedAt?: number };

export function mergeVaults(a: VaultData, b: VaultData): VaultData {
  const deleted: Record<string, number> = { ...(a.deleted ?? {}) };
  for (const [id, ts] of Object.entries(b.deleted ?? {})) deleted[id] = Math.max(deleted[id] ?? 0, ts);
  const cutoff = Date.now() - TOMBSTONE_TTL;
  for (const [id, ts] of Object.entries(deleted)) if (ts < cutoff) delete deleted[id];

  const alive = (x: Stamped) => !(deleted[x.id] && deleted[x.id] >= (x.updatedAt ?? 0));
  const pick = <T extends Stamped>(x: T | undefined, y: T) => (!x ? y : (y.updatedAt ?? 0) >= (x.updatedAt ?? 0) ? y : x);

  const clips = new Map(a.clips.map((c) => [c.id, c]));
  for (const c of b.clips) clips.set(c.id, pick(clips.get(c.id), c));

  const cats = new Map(b.categories.map((c) => [c.id, c]));
  for (const c of a.categories) cats.set(c.id, cats.has(c.id) ? pick(c, cats.get(c.id)!) : c);

  return {
    version: 1,
    clips: [...clips.values()].filter(alive).sort((x, y) => y.updatedAt - x.updatedAt || (x.id < y.id ? -1 : 1)),
    categories: [...cats.values()].filter(alive),
    deleted,
  };
}

/** Cheap check whether a merge changed anything the user would see. */
export function sameVault(a: VaultData, b: VaultData) {
  const sig = (d: VaultData) =>
    JSON.stringify([
      d.clips.map((c) => [c.id, c.updatedAt]).sort(),
      d.categories.map((c) => [c.id, c.updatedAt ?? 0, c.name]),
    ]);
  return sig(a) === sig(b);
}
