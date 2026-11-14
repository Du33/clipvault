import type { Category, Clip, ClipDraft, VaultData } from './types';

export const uid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const URL_RE = /^(https?:\/\/|www\.)[^\s]+$/i;

export function isLink(text: string) {
  return URL_RE.test(text.trim());
}

export function normalizeUrl(text: string) {
  const t = text.trim();
  return /^www\./i.test(t) ? `https://${t}` : t;
}

export function domainOf(text: string) {
  try {
    return new URL(normalizeUrl(text)).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

export function guessTitle(content: string) {
  const text = content.trim();
  if (isLink(text)) {
    try {
      const url = new URL(normalizeUrl(text));
      const host = url.hostname.replace(/^www\./, '');
      const last = url.pathname.split('/').filter(Boolean).pop();
      if (!last) return host;
      const pretty = decodeURIComponent(last)
        .replace(/\.[a-z0-9]{2,5}$/i, '')
        .replace(/[-_+]+/g, ' ')
        .trim();
      return pretty ? `${pretty.charAt(0).toUpperCase()}${pretty.slice(1)} · ${host}` : host;
    } catch {
      return text.slice(0, 60);
    }
  }
  const firstLine = text.split(/\r?\n/).find((l) => l.trim()) ?? '';
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine || 'Untitled snippet';
}

export function parseTags(input: string) {
  return Array.from(
    new Set(
      input
        .split(/[,\s]+/)
        .map((t) => t.replace(/^#/, '').trim().toLowerCase())
        .filter(Boolean),
    ),
  );
}

export function makeClip(draft: Partial<ClipDraft> & { content: string }): Clip {
  const now = Date.now();
  const image = draft.image ?? null;
  return {
    id: uid(),
    title: draft.title?.trim() || (image && !draft.content.trim() ? imageTitle(now) : guessTitle(draft.content)),
    content: draft.content,
    image,
    note: draft.note ?? '',
    categoryId: draft.categoryId ?? null,
    tags: draft.tags ?? [],
    favorite: draft.favorite ?? false,
    copyCount: 0,
    createdAt: now,
    updatedAt: now,
    lastCopiedAt: null,
  };
}

export function imageTitle(ts = Date.now()) {
  return `Screenshot · ${new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
}

export type ClipKind = 'image' | 'link' | 'text';

export function clipKind(c: Pick<Clip, 'image' | 'content'>): ClipKind {
  if (c.image) return 'image';
  return isLink(c.content) ? 'link' : 'text';
}

/** Fills in fields added in later versions so older vault files keep working. */
export function normalizeData(d: VaultData): VaultData {
  return {
    ...d,
    categories: d.categories ?? [],
    deleted: d.deleted ?? {},
    clips: (d.clips ?? []).map((c) => ({
      ...c,
      content: c.content ?? '',
      image: c.image ?? null,
      note: c.note ?? '',
      tags: c.tags ?? [],
    })),
  };
}

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function seedData(): VaultData {
  const categories: Category[] = [
    { id: uid(), name: 'Work', emoji: '💼', color: 'sky' },
    { id: uid(), name: 'Reading', emoji: '📚', color: 'peach' },
    { id: uid(), name: 'Code', emoji: '💻', color: 'lavender' },
    { id: uid(), name: 'Inspiration', emoji: '✨', color: 'gold' },
  ];
  const [work, reading, code, inspo] = categories;
  const clips: Clip[] = [
    makeClip({
      content: 'https://developer.apple.com/design/human-interface-guidelines/materials',
      title: 'Apple HIG · Materials',
      categoryId: inspo.id,
      tags: ['design', 'glass'],
      favorite: true,
      note: 'Reference for the frosted glass look.',
    }),
    makeClip({
      content: 'https://www.electronjs.org/docs/latest/',
      title: 'Electron docs',
      categoryId: code.id,
      tags: ['docs'],
    }),
    makeClip({
      content: 'git log --oneline --graph --decorate --all',
      title: 'Pretty git log',
      categoryId: code.id,
      tags: ['git', 'terminal'],
      favorite: true,
    }),
    makeClip({
      content: 'Thanks so much for the quick turnaround — really appreciate it! Let me know if there is anything I can do to help on my side.',
      title: 'Thank-you reply',
      categoryId: work.id,
      tags: ['email'],
      note: 'Use for vendor follow-ups.\nSwap in their name and the project before sending.',
    }),
    makeClip({
      content: 'https://paulgraham.com/greatwork.html',
      title: 'How to Do Great Work',
      categoryId: reading.id,
      tags: ['essay'],
    }),
  ];
  return { version: 1, categories, clips };
}
