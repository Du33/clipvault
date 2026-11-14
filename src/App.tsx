import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, imageUrl, isDesktop, saveImageFromTransfer, type PrivateData, type QuickCapture, type SyncStatus } from './api';
import { ClipCard } from './components/ClipCard';
import { ClipDetail } from './components/ClipDetail';
import { ClipEditor } from './components/ClipEditor';
import { Icon } from './components/Icon';
import { PinPad, type PinMode } from './components/PinPad';
import { Sidebar } from './components/Sidebar';
import type { Category, CategoryColor, Clip, ClipDraft, ImageInfo, SortMode, VaultData, View } from './types';
import { clipKind, isLink, makeClip, normalizeData, normalizeUrl, seedData, uid } from './utils';
import { mergeVaults, sameVault } from './merge';
import { SyncSettings } from './components/SyncSettings';

type Toast = { id: number; text: string; undo?: () => void };
type EditorState = { clip: Clip | null; initialContent?: string; initialImage?: ImageInfo } | null;

const isTypingTarget = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));

const hasImageFile = (dt: DataTransfer | null) =>
  !!dt && Array.from(dt.items).some((i) => i.kind === 'file' && i.type.startsWith('image/'));

const priv = api.private;

export default function App() {
  const [data, setData] = useState<VaultData | null>(null);
  const [view, setView] = useState<View>({ kind: 'all' });
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [editor, setEditor] = useState<EditorState>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [platform, setPlatform] = useState('web');
  const [shortcut, setShortcut] = useState('');
  const [preview, setPreview] = useState<Clip | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  // Private vault: `privateData` is non-null only while unlocked.
  const [privateData, setPrivateData] = useState<PrivateData | null>(null);
  const [privateExists, setPrivateExists] = useState(false);
  const [pinMode, setPinMode] = useState<PinMode | null>(null);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const loaded = useRef(false);
  const dataRef = useRef<VaultData | null>(null);
  dataRef.current = data;
  const privRef = useRef<PrivateData | null>(null);
  privRef.current = privateData;
  const privDirty = useRef(false);

  const isPrivate = view.kind === 'private' && privateData !== null;
  // While any dialog is open, global paste/drop/shortcuts must not create clips behind it.
  const modalOpen = Boolean(editor || detailId || pinMode || settingsOpen);

  useEffect(() => {
    api.load().then((d) => {
      setData(d && Array.isArray(d.clips) ? normalizeData(d) : seedData());
      loaded.current = true;
    });
    api.info().then((i) => {
      setPlatform(i.platform);
      setShortcut(i.shortcut.replace('CommandOrControl', i.platform === 'darwin' ? '⌘' : 'Ctrl').replace(/\+/g, ' + '));
    });
    priv?.status().then(async (s) => {
      setPrivateExists(s.exists);
      setLockedUntil(s.lockedUntil);
      // Still unlocked in the main process (e.g. after a UI reload).
      if (s.unlocked) setPrivateData(await priv.load());
    });
    api.sync?.status().then(setSyncStatus);
  }, []);

  // Debounced persistence.
  useEffect(() => {
    if (!data || !loaded.current) return;
    const t = setTimeout(() => api.save(data), 250);
    return () => clearTimeout(t);
  }, [data]);

  // Changes synced in from another device (via the cloud folder).
  useEffect(
    () =>
      api.onStoreChanged?.((incoming) => {
        const remote = normalizeData(incoming);
        const cur = dataRef.current;
        if (!cur) return;
        // Local wins ties so in-progress edits on this device aren't overwritten.
        const merged = mergeVaults(remote, cur);
        if (sameVault(merged, cur)) return;
        setData(merged);
        setToast({ id: Date.now(), text: 'Synced changes from another device ☁️' });
      }),
    [],
  );

  useEffect(() => {
    if (!privateData || !privDirty.current) return;
    const t = setTimeout(() => {
      privDirty.current = false;
      priv?.save(privateData);
    }, 250);
    return () => clearTimeout(t);
  }, [privateData]);

  // Leave the private view if the vault gets locked.
  useEffect(() => {
    if (view.kind === 'private' && !privateData) setView({ kind: 'all' });
  }, [view, privateData]);

  const showToast = useCallback((text: string, undo?: () => void) => {
    setToast({ id: Date.now(), text, undo });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.undo ? 5000 : 2200);
    return () => clearTimeout(t);
  }, [toast]);

  const update = useCallback((fn: (d: VaultData) => VaultData) => setData((d) => (d ? fn(d) : d)), []);

  const updatePrivate = useCallback((fn: (clips: Clip[]) => Clip[]) => {
    privDirty.current = true;
    setPrivateData((p) => (p ? { ...p, clips: fn(p.clips) } : p));
  }, []);

  /** Applies a change to the clip list of whichever vault is on screen. */
  const updateClips = useCallback(
    (fn: (clips: Clip[]) => Clip[]) => (isPrivate ? updatePrivate(fn) : update((d) => ({ ...d, clips: fn(d.clips) }))),
    [isPrivate, update, updatePrivate],
  );

  const activeClips = useCallback(
    () => (isPrivate ? privRef.current?.clips : dataRef.current?.clips) ?? [],
    [isPrivate],
  );

  /** Private clips must only reference encrypted images. */
  const secureImage = useCallback(
    async (image: ImageInfo | null) => {
      if (!image || !isPrivate || image.private) return image;
      return (await priv?.adoptImage(image)) ?? null;
    },
    [isPrivate],
  );

  const currentCategoryId = view.kind === 'category' ? view.id : null;

  const quickAdd = useCallback(
    (text: string) => {
      const content = text.replace(/\s+$/, '');
      if (!content.trim()) return;
      const existing = activeClips().find((c) => !c.image && c.content.trim() === content.trim());
      if (existing) {
        updateClips((clips) => clips.map((c) => (c.id === existing.id ? { ...c, updatedAt: Date.now() } : c)));
        showToast('Already in your vault — moved to top');
        return;
      }
      const clip = makeClip({ content, categoryId: currentCategoryId });
      updateClips((clips) => [clip, ...clips]);
      showToast(isLink(content) ? 'Link saved' : 'Snippet saved');
    },
    [updateClips, activeClips, currentCategoryId, showToast],
  );

  const addImage = useCallback(
    async (raw: ImageInfo | null) => {
      const image = await secureImage(raw);
      if (!image) {
        showToast('Could not read that image');
        return;
      }
      const clip = makeClip({ content: '', image, categoryId: currentCategoryId });
      updateClips((clips) => [clip, ...clips]);
      showToast(isPrivate ? 'Screenshot saved privately' : 'Screenshot saved');
    },
    [updateClips, secureImage, currentCategoryId, showToast, isPrivate],
  );

  const saveTransferImages = useCallback(
    async (dt: DataTransfer) => {
      const files = Array.from(dt.files).filter((f) => f.type.startsWith('image/'));
      if (files.length <= 1) return addImage(await saveImageFromTransfer(dt));
      for (const f of files) await addImage(await api.saveImage(new Uint8Array(await f.arrayBuffer()), f.type));
      showToast(`${files.length} images saved`);
    },
    [addImage, showToast],
  );

  useEffect(
    () => api.onQuickCapture((p: QuickCapture) => (p.image ? addImage(p.image) : p.text && quickAdd(p.text))),
    [quickAdd, addImage],
  );

  // Paste anywhere (outside of text fields) to save instantly — text, links or screenshots.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (modalOpen || isTypingTarget(e.target)) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text?.trim()) {
        e.preventDefault();
        quickAdd(text);
      } else if (e.clipboardData && hasImageFile(e.clipboardData)) {
        e.preventDefault();
        saveTransferImages(e.clipboardData);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [quickAdd, saveTransferImages, modalOpen]);

  // Drop image files from Explorer/Finder or a browser onto the window.
  useEffect(() => {
    const isFileDrag = (e: DragEvent) => !!e.dataTransfer && e.dataTransfer.types.includes('Files');
    const onOver = (e: DragEvent) => {
      if (!isFileDrag(e) || modalOpen) return;
      e.preventDefault();
      setDropping(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!e.relatedTarget) setDropping(false);
    };
    const onDrop = (e: DragEvent) => {
      setDropping(false);
      if (!isFileDrag(e) || modalOpen) return;
      e.preventDefault();
      if (hasImageFile(e.dataTransfer)) saveTransferImages(e.dataTransfer!);
      else showToast('Only image files can be dropped');
    };
    window.addEventListener('dragover', onOver);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, [saveTransferImages, modalOpen, showToast]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (mod && e.key.toLowerCase() === 'n' && !modalOpen) {
        e.preventDefault();
        setEditor({ clip: null });
      } else if (e.key === 'Escape' && document.activeElement === searchRef.current) {
        setQuery('');
        searchRef.current?.blur();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [modalOpen]);

  const pasteFromClipboard = async () => {
    try {
      const text = await api.readClipboard();
      if (text.trim()) {
        setEditor({ clip: null, initialContent: text });
        return;
      }
      const image = await api.readClipboardImage();
      if (image) setEditor({ clip: null, initialImage: image });
      else showToast('Clipboard is empty');
    } catch {
      showToast('Could not read the clipboard');
    }
  };

  const copyClip = async (clip: Clip) => {
    try {
      const ok = clip.image
        ? await api.writeClipboardImage(clip.image.ref, clip.image.private)
        : await api.writeClipboard(clip.content);
      if (!ok) throw new Error('copy failed');
    } catch {
      showToast(clip.image ? 'Image file is missing' : 'Copy failed');
      return;
    }
    updateClips((clips) =>
      clips.map((c) => (c.id === clip.id ? { ...c, copyCount: c.copyCount + 1, lastCopiedAt: Date.now() } : c)),
    );
    setCopiedId(clip.id);
    setTimeout(() => setCopiedId((id) => (id === clip.id ? null : id)), 1200);
    showToast(`Copied “${clip.title}”`);
  };

  const saveDraft = async (raw: ClipDraft) => {
    const draft = { ...raw, image: await secureImage(raw.image) };
    const editing = editor?.clip;
    if (editing) {
      const editingId = editing.id;
      updateClips((clips) => clips.map((c) => (c.id === editingId ? { ...c, ...draft, updatedAt: Date.now() } : c)));
      showToast('Clip updated');
    } else {
      updateClips((clips) => [makeClip(draft), ...clips]);
      showToast(isPrivate ? 'Saved privately' : 'Clip saved');
    }
    setEditor(null);
  };

  const deleteClip = (clip: Clip) => {
    const index = Math.max(0, activeClips().findIndex((c) => c.id === clip.id));
    const insertBack = (clips: Clip[], c: Clip) => {
      const next = [...clips];
      next.splice(Math.min(index, next.length), 0, c);
      return next;
    };
    if (isPrivate) {
      updatePrivate((clips) => clips.filter((c) => c.id !== clip.id));
      showToast('Clip deleted', () => updatePrivate((clips) => insertBack(clips, clip)));
      return;
    }
    update((d) => ({
      ...d,
      clips: d.clips.filter((c) => c.id !== clip.id),
      deleted: { ...d.deleted, [clip.id]: Date.now() },
    }));
    showToast('Clip deleted', () =>
      update((d) => {
        const { [clip.id]: _gone, ...deleted } = d.deleted ?? {};
        // Newer than the tombstone, so it also survives a sync merge.
        return { ...d, deleted, clips: insertBack(d.clips, { ...clip, updatedAt: Date.now() }) };
      }),
    );
  };

  const patchClip = (id: string, patch: Partial<Clip>) =>
    updateClips((clips) => clips.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)));

  // ---- Private vault ----

  const submitPin = async (pin: string): Promise<string | null> => {
    if (!priv || !pinMode) return 'Not available';
    try {
      if (pinMode === 'setup') {
        setPrivateData(await priv.setup(pin));
        setPrivateExists(true);
        showToast('Private vault created');
      } else if (pinMode === 'change') {
        await priv.changePin(pin);
        showToast('PIN changed');
        setPinMode(null);
        return null;
      } else {
        const res = await priv.unlock(pin);
        if (!res.ok) {
          setLockedUntil(res.lockedUntil ?? 0);
          if (res.lockedUntil && res.lockedUntil > Date.now()) return 'Too many attempts';
          return res.attemptsLeft ? `Wrong PIN · ${res.attemptsLeft} ${res.attemptsLeft === 1 ? 'try' : 'tries'} left` : 'Wrong PIN';
        }
        setLockedUntil(0);
        setPrivateData(res.data ?? { version: 1, clips: [] });
      }
    } catch (e) {
      return e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong';
    }
    setPinMode(null);
    setQuery('');
    setView({ kind: 'private' });
    return null;
  };

  const lockPrivate = async () => {
    if (!priv) return;
    // Flush any pending debounced save before the key is dropped.
    if (privDirty.current && privRef.current) {
      privDirty.current = false;
      await priv.save(privRef.current);
    }
    await priv.lock();
    setPrivateData(null);
    setPreview(null);
    setEditor(null);
    setDetailId(null);
    setView({ kind: 'all' });
    showToast('Private vault locked');
  };

  const erasePrivate = async () => {
    await priv?.erase();
    setPrivateData(null);
    setPrivateExists(false);
    setLockedUntil(0);
    setPinMode(null);
    showToast('Private vault erased');
  };

  const openPrivate = async () => {
    if (privateData) {
      setQuery('');
      setView({ kind: 'private' });
      return;
    }
    const s = await priv?.status();
    if (s) {
      setPrivateExists(s.exists);
      setLockedUntil(s.lockedUntil);
    }
    setPinMode(s?.exists ? 'unlock' : 'setup');
  };

  const moveToPrivate = async (clip: Clip) => {
    if (!priv || !privateData) return;
    const image = clip.image ? await priv.adoptImage(clip.image) : null;
    if (clip.image && !image) return showToast('Could not move the image');
    update((d) => ({ ...d, clips: d.clips.filter((c) => c.id !== clip.id), deleted: { ...d.deleted, [clip.id]: Date.now() } }));
    updatePrivate((clips) => [{ ...clip, image, updatedAt: Date.now() }, ...clips]);
    showToast('Moved to Private 🔒');
  };

  const moveToMain = async (clip: Clip) => {
    if (!priv) return;
    const image = clip.image ? await priv.exportImage(clip.image) : null;
    if (clip.image && !image) return showToast('Could not move the image');
    updatePrivate((clips) => clips.filter((c) => c.id !== clip.id));
    update((d) => {
      const { [clip.id]: _gone, ...deleted } = d.deleted ?? {};
      return { ...d, deleted, clips: [{ ...clip, image, updatedAt: Date.now() }, ...d.clips] };
    });
    showToast('Moved out of Private');
  };

  // ---- Cloud sync ----

  const enableSync = async (root: string) => {
    if (!api.sync || !dataRef.current) return;
    const before = dataRef.current.clips.length;
    const res = await api.sync.enable(root, dataRef.current);
    setData(normalizeData(res.data));
    setSyncStatus(res.status);
    const added = res.data.clips.length - before;
    showToast(added > 0 ? `Syncing via ${res.status.provider} · merged ${added} clips from the cloud` : `Syncing via ${res.status.provider} ☁️`);
  };

  const chooseSyncFolder = async () => {
    const dir = await api.sync?.choose();
    if (dir) await enableSync(dir);
  };

  const disableSync = async () => {
    if (!api.sync || !dataRef.current) return;
    const res = await api.sync.disable(dataRef.current);
    setData(normalizeData(res.data));
    setSyncStatus(res.status);
    showToast('Sync stopped · a full copy is kept on this computer');
  };

  const addCategory = (name: string, emoji: string, color: CategoryColor) => {
    const cat: Category = { id: uid(), name, emoji, color, updatedAt: Date.now() };
    update((d) => ({ ...d, categories: [...d.categories, cat] }));
    setView({ kind: 'category', id: cat.id });
  };

  const updateCategory = (id: string, patch: Partial<Category>) =>
    update((d) => ({ ...d, categories: d.categories.map((c) => (c.id === id ? { ...c, ...patch, updatedAt: Date.now() } : c)) }));

  const deleteCategory = (id: string) => {
    const snapshot = dataRef.current;
    const cat = snapshot?.categories.find((c) => c.id === id);
    if (!snapshot || !cat) return;
    const index = snapshot.categories.indexOf(cat);
    const movedIds = new Set(snapshot.clips.filter((c) => c.categoryId === id).map((c) => c.id));
    update((d) => ({
      ...d,
      categories: d.categories.filter((c) => c.id !== id),
      clips: d.clips.map((c) => (c.categoryId === id ? { ...c, categoryId: null } : c)),
      deleted: { ...d.deleted, [id]: Date.now() },
    }));
    if (view.kind === 'category' && view.id === id) setView({ kind: 'all' });
    showToast(`Deleted ${cat.emoji} ${cat.name}`, () =>
      update((d) => {
        const categories = [...d.categories];
        categories.splice(Math.min(index, categories.length), 0, { ...cat, updatedAt: Date.now() });
        const { [id]: _gone, ...deleted } = d.deleted ?? {};
        return {
          ...d,
          categories,
          deleted,
          clips: d.clips.map((c) => (movedIds.has(c.id) && c.categoryId === null ? { ...c, categoryId: id } : c)),
        };
      }),
    );
  };

  const dropClip = (clipId: string, categoryId: string | null) => {
    patchClip(clipId, { categoryId });
    const cat = data?.categories.find((c) => c.id === categoryId);
    showToast(cat ? `Moved to ${cat.emoji} ${cat.name}` : 'Moved to Unsorted');
  };

  const categoriesById = useMemo(() => new Map((data?.categories ?? []).map((c) => [c.id, c])), [data?.categories]);

  const counts = useMemo(() => {
    const out: Record<string, number> = { all: 0, favorites: 0, links: 0, snippets: 0, images: 0, notes: 0, uncategorized: 0 };
    for (const c of data?.clips ?? []) {
      out.all++;
      if (c.favorite) out.favorites++;
      if (c.note.trim()) out.notes++;
      const kind = clipKind(c);
      if (kind === 'link') out.links++;
      else if (kind === 'image') out.images++;
      else out.snippets++;
      if (!c.categoryId || !categoriesById.has(c.categoryId)) out.uncategorized++;
      else out[c.categoryId] = (out[c.categoryId] ?? 0) + 1;
    }
    return out;
  }, [data?.clips, categoriesById]);

  const visible = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const source = view.kind === 'private' ? privateData?.clips ?? [] : data.clips;
    let list = source.filter((c) => {
      switch (view.kind) {
        case 'favorites':
          return c.favorite;
        case 'links':
          return clipKind(c) === 'link';
        case 'snippets':
          return clipKind(c) === 'text';
        case 'images':
          return clipKind(c) === 'image';
        case 'notes':
          return Boolean(c.note.trim());
        case 'uncategorized':
          return !c.categoryId || !categoriesById.has(c.categoryId);
        case 'category':
          return c.categoryId === view.id;
        default:
          return true;
      }
    });
    if (terms.length) {
      list = list.filter((c) => {
        const cat = c.categoryId ? categoriesById.get(c.categoryId)?.name ?? '' : '';
        const hay = `${c.title}\n${c.content}\n${c.note}\n${cat}\n${c.tags.map((t) => `#${t}`).join(' ')}${c.image ? '\nimage screenshot' : ''}`.toLowerCase();
        return terms.every((t) => hay.includes(t));
      });
    }
    const sorted = [...list];
    if (sort === 'popular') sorted.sort((a, b) => b.copyCount - a.copyCount || b.updatedAt - a.updatedAt);
    else if (sort === 'alpha') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt);
    return sorted;
  }, [data, privateData, view, query, sort, categoriesById]);

  const detailClip = detailId
    ? (view.kind === 'private' ? privateData?.clips : data?.clips)?.find((c) => c.id === detailId) ?? null
    : null;

  // Close the detail view if its clip disappears (deleted, moved, vault locked).
  useEffect(() => {
    if (detailId && !detailClip) setDetailId(null);
  }, [detailId, detailClip]);

  const heading = (() => {
    switch (view.kind) {
      case 'private':
        return { emoji: '🔒', title: 'Private' };
      case 'favorites':
        return { emoji: '⭐', title: 'Favorites' };
      case 'links':
        return { emoji: '🔗', title: 'Links' };
      case 'snippets':
        return { emoji: '📝', title: 'Snippets' };
      case 'images':
        return { emoji: '🖼️', title: 'Images' };
      case 'notes':
        return { emoji: '🗒️', title: 'With Notes' };
      case 'uncategorized':
        return { emoji: '📥', title: 'Unsorted' };
      case 'category': {
        const c = categoriesById.get(view.id);
        return { emoji: c?.emoji ?? '📁', title: c?.name ?? 'Category' };
      }
      default:
        return { emoji: '☁️', title: 'All Clips' };
    }
  })();

  if (!data) return <Backdrop />;

  return (
    <div className={`app platform-${platform}${isDesktop ? ' desktop' : ''}${isPrivate ? ' is-private' : ''}`}>
      <Backdrop />
      <div className="titlebar drag" aria-hidden="true" />
      <Sidebar
        view={view}
        onView={setView}
        categories={data.categories}
        counts={counts}
        onAddCategory={addCategory}
        onUpdateCategory={updateCategory}
        onDeleteCategory={deleteCategory}
        onDropClip={dropClip}
        privateSupported={Boolean(priv)}
        privateUnlocked={privateData !== null}
        privateCount={privateData?.clips.length ?? 0}
        onOpenPrivate={openPrivate}
        onLockPrivate={lockPrivate}
        syncLabel={api.sync ? (syncStatus?.syncing ? syncStatus.provider ?? 'Synced' : 'This computer') : null}
        syncing={Boolean(syncStatus?.syncing)}
        onOpenSettings={async () => {
          setSyncStatus((await api.sync?.status()) ?? null);
          setSettingsOpen(true);
        }}
      />

      <main className="main">
        <div className="toolbar">
          <div className="search glass">
            <Icon name="search" size={16} />
            <input
              ref={searchRef}
              placeholder={isPrivate ? 'Search private clips…' : 'Search clips, tags, notes…'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query ? (
              <button className="icon-btn tiny" onClick={() => setQuery('')} title="Clear">
                <Icon name="close" size={13} />
              </button>
            ) : (
              <kbd>{platform === 'darwin' ? '⌘F' : 'Ctrl F'}</kbd>
            )}
          </div>
          <button className="btn glass" onClick={pasteFromClipboard} title="Save what's on your clipboard">
            <Icon name="clipboard" size={16} /> Paste
          </button>
          <button className="btn primary" onClick={() => setEditor({ clip: null })}>
            <Icon name="plus" size={16} /> New Clip
          </button>
        </div>

        <section className="hero">
          <div>
            <h1>
              <span className="hero-emoji">{heading.emoji}</span>
              {heading.title}
            </h1>
            <p className="sub">
              {visible.length} {visible.length === 1 ? 'clip' : 'clips'}
              {query && ` matching “${query}”`}
              {isPrivate ? (
                <> · Encrypted with your PIN · Locks when you close the app</>
              ) : (
                <>
                  {shortcut && isDesktop && <> · Press <b>{shortcut}</b> anywhere to save your clipboard</>}
                  {!isDesktop && <> · Press <b>{platform === 'darwin' ? '⌘V' : 'Ctrl V'}</b> to save instantly</>}
                </>
              )}
            </p>
          </div>
          {isPrivate && (
            <div className="private-actions">
              <button className="btn glass small" onClick={() => setPinMode('change')}>
                <Icon name="key" size={14} /> Change PIN
              </button>
              <button className="btn glass small" onClick={lockPrivate}>
                <Icon name="lock" size={14} /> Lock
              </button>
            </div>
          )}
          <div className="segmented glass">
            {(
              [
                ['recent', 'Recent'],
                ['popular', 'Most used'],
                ['alpha', 'A–Z'],
              ] as const
            ).map(([k, label]) => (
              <button key={k} className={sort === k ? 'on' : ''} onClick={() => setSort(k)}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <div className="grid-scroll">
          {visible.length === 0 ? (
            <EmptyState query={query} isPrivate={isPrivate} onNew={() => setEditor({ clip: null })} onPaste={pasteFromClipboard} />
          ) : (
            <div className="grid">
              {visible.map((clip) => (
                <ClipCard
                  key={clip.id}
                  clip={clip}
                  category={clip.categoryId ? categoriesById.get(clip.categoryId) : undefined}
                  justCopied={copiedId === clip.id}
                  onCopy={() => copyClip(clip)}
                  onOpen={() => api.openExternal(normalizeUrl(clip.content))}
                  onPreview={() => setPreview(clip)}
                  onEdit={() => setDetailId(clip.id)}
                  onDelete={() => deleteClip(clip)}
                  onToggleFavorite={() => patchClip(clip.id, { favorite: !clip.favorite })}
                  onTag={(t) => setQuery(`#${t}`)}
                  privacyAction={
                    !privateData ? undefined : isPrivate ? { kind: 'out', run: () => moveToMain(clip) } : { kind: 'in', run: () => moveToPrivate(clip) }
                  }
                  onSaveNote={(note) => {
                    patchClip(clip.id, { note });
                    showToast(note ? 'Note saved' : 'Note removed');
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {editor && (
        <ClipEditor
          clip={editor.clip}
          initialContent={editor.initialContent}
          initialImage={editor.initialImage}
          defaultCategoryId={currentCategoryId}
          categories={data.categories}
          onSave={saveDraft}
          onClose={() => setEditor(null)}
        />
      )}

      {detailClip && (
        <ClipDetail
          key={detailClip.id}
          clip={detailClip}
          categories={data.categories}
          isPrivate={isPrivate}
          onChange={(patch) => patchClip(detailClip.id, patch)}
          onCopy={(c) => copyClip(c)}
          onOpenLink={(url) => api.openExternal(normalizeUrl(url))}
          onPreviewImage={() => setPreview(detailClip)}
          onDelete={() => {
            setDetailId(null);
            deleteClip(detailClip);
          }}
          onClose={() => setDetailId(null)}
          privacyAction={
            !privateData
              ? undefined
              : isPrivate
                ? { kind: 'out', run: () => moveToMain(detailClip) }
                : { kind: 'in', run: () => moveToPrivate(detailClip) }
          }
        />
      )}

      {settingsOpen && (
        <SyncSettings
          status={syncStatus}
          onEnable={enableSync}
          onChooseFolder={chooseSyncFolder}
          onDisable={disableSync}
          onOpenFolder={() => api.sync?.open()}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {pinMode && (
        <PinPad
          mode={pinMode}
          lockedUntil={lockedUntil}
          onSubmit={submitPin}
          onErase={privateExists ? erasePrivate : undefined}
          onClose={() => setPinMode(null)}
        />
      )}

      {preview?.image && (
        <Lightbox
          clip={preview}
          onClose={() => setPreview(null)}
          onCopy={() => {
            copyClip(preview);
            setPreview(null);
          }}
        />
      )}

      {dropping && (
        <div className="drop-overlay">
          <div className="drop-card glass-strong">
            <Icon name="image" size={28} />
            <span>Drop images to save them</span>
          </div>
        </div>
      )}

      {toast && (
        <div key={toast.id} className="toast glass-strong" role="status">
          <Icon name="check" size={15} />
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              className="toast-undo"
              onClick={() => {
                toast.undo?.();
                setToast(null);
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Backdrop() {
  return (
    <div className="sky" aria-hidden="true">
      <div className="sun" />
      <div className="rays" />
      <div className="cloud c1" />
      <div className="cloud c2" />
      <div className="cloud c3" />
      <div className="frost" />
      <div className="rays rays-soft" />
      <div className="grain" />
    </div>
  );
}

function Lightbox({ clip, onClose, onCopy }: { clip: Clip; onClose: () => void; onCopy: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!clip.image) return null;
  return (
    <div className="lightbox" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <figure className="lightbox-frame glass-strong">
        <img src={imageUrl(clip.image)} alt={clip.title} />
        <figcaption>
          <div>
            <strong>{clip.title}</strong>
            <span>
              {clip.image.width} × {clip.image.height}
            </span>
          </div>
          <span className="spacer" />
          <button className="btn small" onClick={onClose}>
            Close
          </button>
          <button className="btn primary small" onClick={onCopy}>
            <Icon name="copy" size={14} /> Copy image
          </button>
        </figcaption>
      </figure>
    </div>
  );
}

function EmptyState({ query, isPrivate, onNew, onPaste }: { query: string; isPrivate: boolean; onNew: () => void; onPaste: () => void }) {
  return (
    <div className="empty glass">
      <div className="empty-icon">{query ? '🔍' : isPrivate ? '🔒' : '☀️'}</div>
      <h2>{query ? 'Nothing matches that search' : isPrivate ? 'Your private space is empty' : 'A clear sky — nothing here yet'}</h2>
      <p>
        {query
          ? 'Try a different word or tag.'
          : isPrivate
            ? 'Anything you save here is encrypted with your PIN. You can also move clips in with the 🔒 button on a card.'
            : 'Paste a link, snippet or screenshot to start building your vault.'}
      </p>
      {!query && (
        <div className="empty-actions">
          <button className="btn glass" onClick={onPaste}>
            <Icon name="clipboard" size={16} /> Paste from clipboard
          </button>
          <button className="btn primary" onClick={onNew}>
            <Icon name="plus" size={16} /> New Clip
          </button>
        </div>
      )}
    </div>
  );
}
