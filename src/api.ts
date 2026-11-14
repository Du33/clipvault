import type { Clip, ImageInfo, VaultData } from './types';

export type QuickCapture = { text?: string; image?: ImageInfo };

export type PrivateData = { version: 1; clips: Clip[] };
export type PrivateStatus = { supported: boolean; exists: boolean; unlocked: boolean; lockedUntil: number };
export type UnlockResult = { ok: boolean; data?: PrivateData; attemptsLeft?: number; lockedUntil?: number; error?: string };

type PrivateBridge = {
  status: () => Promise<PrivateStatus>;
  setup: (pin: string) => Promise<PrivateData>;
  unlock: (pin: string) => Promise<UnlockResult>;
  load: () => Promise<PrivateData>;
  save: (data: PrivateData) => Promise<boolean>;
  lock: () => Promise<void>;
  changePin: (pin: string) => Promise<boolean>;
  erase: () => Promise<boolean>;
  adoptImage: (info: ImageInfo) => Promise<ImageInfo | null>;
  exportImage: (info: ImageInfo) => Promise<ImageInfo | null>;
};

export type SyncProvider = { id: 'onedrive' | 'gdrive' | 'icloud'; name: string; path: string };
export type SyncStatus = { syncing: boolean; dir: string | null; provider: string | null; detected: SyncProvider[] };

type SyncBridge = {
  status: () => Promise<SyncStatus>;
  choose: () => Promise<string | null>;
  enable: (root: string, data: VaultData) => Promise<{ data: VaultData; status: SyncStatus }>;
  disable: (data: VaultData) => Promise<{ data: VaultData; status: SyncStatus }>;
  open: () => Promise<void>;
};

type Bridge = {
  load: () => Promise<VaultData | null>;
  save: (data: VaultData) => Promise<boolean>;
  readClipboard: () => Promise<string>;
  writeClipboard: (text: string) => Promise<boolean>;
  readClipboardImage: () => Promise<ImageInfo | null>;
  writeClipboardImage: (ref: string, isPrivate?: boolean) => Promise<boolean>;
  saveImage: (bytes: Uint8Array, mime: string) => Promise<ImageInfo | null>;
  openExternal: (url: string) => Promise<void>;
  info: () => Promise<{ platform: string; shortcut: string }>;
  onQuickCapture: (cb: (payload: QuickCapture) => void) => () => void;
  onStoreChanged?: (cb: (data: VaultData) => void) => () => void;
  private?: PrivateBridge;
  sync?: SyncBridge;
};

declare global {
  interface Window {
    clipvault?: Bridge;
  }
}

const STORAGE_KEY = 'clipvault:data';
const IMG_KEY = 'clipvault:img:';

const uuid = () => crypto.randomUUID();

function bytesToDataUrl(bytes: Uint8Array, mime: string) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${mime};base64,${btoa(bin)}`;
}

function measure(src: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = reject;
    img.src = src;
  });
}

// Browser fallback so the UI can also run with `npm run web` outside Electron.
const webBridge: Bridge = {
  load: async () => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as VaultData) : null;
  },
  save: async (data) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  },
  readClipboard: async () => navigator.clipboard.readText(),
  writeClipboard: async (text) => {
    await navigator.clipboard.writeText(text);
    return true;
  },
  readClipboardImage: async () => {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) {
        const blob = await item.getType(type);
        return webBridge.saveImage(new Uint8Array(await blob.arrayBuffer()), type);
      }
    }
    return null;
  },
  writeClipboardImage: async (ref) => {
    const src = localStorage.getItem(IMG_KEY + ref);
    if (!src) return false;
    const blob = await (await fetch(src)).blob();
    const png = blob.type === 'image/png' ? blob : await toPng(src);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return true;
  },
  saveImage: async (bytes, mime) => {
    const src = bytesToDataUrl(bytes, mime);
    const size = await measure(src);
    const ref = `${uuid()}.${mime.split('/')[1] ?? 'png'}`;
    localStorage.setItem(IMG_KEY + ref, src);
    return { ref, ...size };
  },
  openExternal: async (url) => {
    window.open(url, '_blank', 'noopener');
  },
  info: async () => ({
    platform: /Mac/i.test(navigator.platform) ? 'darwin' : 'web',
    shortcut: 'CommandOrControl+Shift+S',
  }),
  onQuickCapture: () => () => {},
};

async function toPng(src: string) {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));
}

export const api: Bridge = window.clipvault ?? webBridge;
export const isDesktop = Boolean(window.clipvault);

export function imageUrl(img: ImageInfo) {
  if (!isDesktop) return localStorage.getItem(IMG_KEY + img.ref) ?? '';
  return `clipvault-img://${img.private ? 'private' : 'local'}/${encodeURIComponent(img.ref)}`;
}

/** Saves the first image found in a paste/drop DataTransfer, if any. */
export async function saveImageFromTransfer(dt: DataTransfer | null): Promise<ImageInfo | null> {
  const file = dt ? Array.from(dt.files).find((f) => f.type.startsWith('image/')) ?? imageItem(dt) : null;
  if (!file) return null;
  return api.saveImage(new Uint8Array(await file.arrayBuffer()), file.type);
}

function imageItem(dt: DataTransfer) {
  for (const item of Array.from(dt.items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile();
  }
  return null;
}
