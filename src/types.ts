export type ImageInfo = { ref: string; width: number; height: number; private?: boolean };

export type Clip = {
  id: string;
  title: string;
  content: string;
  image: ImageInfo | null;
  note: string;
  categoryId: string | null;
  tags: string[];
  favorite: boolean;
  copyCount: number;
  createdAt: number;
  updatedAt: number;
  lastCopiedAt: number | null;
};

export type Category = {
  id: string;
  name: string;
  emoji: string;
  color: CategoryColor;
  updatedAt?: number;
};

export const CATEGORY_COLORS = ['sky', 'peach', 'coral', 'mint', 'lavender', 'gold'] as const;
export type CategoryColor = (typeof CATEGORY_COLORS)[number];

export type VaultData = {
  version: 1;
  clips: Clip[];
  categories: Category[];
  /** Tombstones (id → deletedAt) so deletions survive syncing between devices. */
  deleted?: Record<string, number>;
};

export type View =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'links' }
  | { kind: 'snippets' }
  | { kind: 'notes' }
  | { kind: 'images' }
  | { kind: 'private' }
  | { kind: 'uncategorized' }
  | { kind: 'category'; id: string };

export type SortMode = 'recent' | 'popular' | 'alpha';

export type ClipDraft = Pick<Clip, 'title' | 'content' | 'image' | 'note' | 'categoryId' | 'tags' | 'favorite'>;
