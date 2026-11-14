// Merges two copies of the vault (e.g. this computer's and one synced from another device).
// Per item, the newer `updatedAt` wins; ties go to `b`. Deletions are tracked as tombstones
// in `deleted` so a clip deleted on one device doesn't come back from another.
// Keep in sync with src/merge.ts (same algorithm for the UI).
const TOMBSTONE_TTL = 90 * 24 * 60 * 60 * 1000;

function mergeVaults(a, b) {
  a = a || {};
  b = b || {};
  const deleted = { ...(a.deleted || {}) };
  for (const [id, ts] of Object.entries(b.deleted || {})) deleted[id] = Math.max(deleted[id] || 0, ts);
  const cutoff = Date.now() - TOMBSTONE_TTL;
  for (const [id, ts] of Object.entries(deleted)) if (ts < cutoff) delete deleted[id];

  const alive = (x) => !(deleted[x.id] && deleted[x.id] >= (x.updatedAt || 0));
  const pick = (x, y) => (!x ? y : (y.updatedAt || 0) >= (x.updatedAt || 0) ? y : x);

  const clips = new Map();
  for (const c of a.clips || []) clips.set(c.id, c);
  for (const c of b.clips || []) clips.set(c.id, pick(clips.get(c.id), c));

  // Categories keep b's order (user-visible), with a-only ones appended.
  const cats = new Map();
  for (const c of b.categories || []) cats.set(c.id, c);
  for (const c of a.categories || []) cats.set(c.id, cats.has(c.id) ? pick(c, cats.get(c.id)) : c);

  return {
    version: 1,
    clips: [...clips.values()].filter(alive).sort((x, y) => (y.updatedAt || 0) - (x.updatedAt || 0) || (x.id < y.id ? -1 : 1)),
    categories: [...cats.values()].filter(alive),
    deleted,
  };
}

module.exports = { mergeVaults };
