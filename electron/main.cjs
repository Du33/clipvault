const {
  app,
  BrowserWindow,
  ipcMain,
  clipboard,
  shell,
  globalShortcut,
  Notification,
  nativeTheme,
  nativeImage,
  protocol,
  net,
  dialog,
} = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const vault = require('./private-vault.cjs');
const sync = require('./sync.cjs');
const { mergeVaults } = require('./merge.cjs');

const isMac = process.platform === 'darwin';
const devUrl = process.env.VITE_DEV_SERVER_URL;
const QUICK_SAVE_SHORTCUT = 'CommandOrControl+Shift+S';
const IMAGE_SCHEME = 'clipvault-img';
const IMAGE_REF_RE = /^[a-f0-9-]{36}\.(png|jpe?g|gif|webp)$/i;
const TITLEBAR_HEIGHT = 40;
// In a synced folder, an image may arrive before the data that references it, so only prune old ones.
const SYNC_PRUNE_AGE = 30 * 24 * 60 * 60 * 1000;

protocol.registerSchemesAsPrivileged([
  { scheme: IMAGE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let win = null;
let imagesPruned = false;
let lastWritten = null; // exact text we last wrote, to ignore our own file-change events

function dataFile() {
  return path.join(sync.dataDir(), sync.DATA_NAME);
}

function imagesDir() {
  return path.join(sync.dataDir(), 'images');
}

function imagePath(ref) {
  if (typeof ref !== 'string' || !IMAGE_REF_RE.test(ref)) return null;
  return path.join(imagesDir(), ref);
}

// Remove image files no clip references any more (e.g. deleted clips). Runs once per launch,
// before anything new is saved, so pending undo actions in a session are never affected.
function pruneImages(data) {
  if (imagesPruned) return;
  imagesPruned = true;
  const minAge = sync.isSyncing() ? SYNC_PRUNE_AGE : 0;
  try {
    const used = new Set((data?.clips ?? []).map((c) => c.image?.ref).filter(Boolean));
    for (const file of fs.readdirSync(imagesDir())) {
      if (!IMAGE_REF_RE.test(file) || used.has(file)) continue;
      const full = path.join(imagesDir(), file);
      if (Date.now() - fs.statSync(full).mtimeMs >= minAge) fs.rmSync(full, { force: true });
    }
  } catch {}
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function readStore() {
  const text = readText(dataFile());
  lastWritten = text;
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {}
  if (data && sync.isSyncing()) {
    const absorbed = sync.absorbConflicts(sync.dataDir(), data);
    // Persist right away so merged-in conflict copies (already removed) aren't lost.
    if (absorbed !== data) lastWritten = sync.writeJson(dataFile(), (data = absorbed));
  }
  pruneImages(data);
  return data;
}

function writeStore(data) {
  let out = data;
  if (sync.isSyncing()) {
    // Another device may have written since we last read/wrote — merge rather than overwrite.
    const diskText = readText(dataFile());
    if (diskText && diskText !== lastWritten) {
      try {
        out = mergeVaults(JSON.parse(diskText), data);
        win?.webContents.send('store:changed', out);
      } catch {}
    }
  }
  lastWritten = sync.writeJson(dataFile(), out);
}

const watcher = sync.createWatcher(
  () => lastWritten,
  (remote) => win?.webContents.send('store:changed', remote),
);

function saveImage(img, ext = 'png', buffer) {
  if (img.isEmpty()) return null;
  fs.mkdirSync(imagesDir(), { recursive: true });
  const ref = `${crypto.randomUUID()}.${ext}`;
  fs.writeFileSync(path.join(imagesDir(), ref), buffer ?? img.toPNG());
  const { width, height } = img.getSize();
  return { ref, width, height };
}

function readClipboardImage() {
  const img = clipboard.readImage();
  return img.isEmpty() ? null : saveImage(img);
}

const isWebUrl = (url) => typeof url === 'string' && /^https?:\/\//i.test(url);

function createWindow() {
  nativeTheme.themeSource = 'light';
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 860,
    minHeight: 560,
    title: 'ClipVault',
    backgroundColor: '#bfe3ff',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    show: false,
    ...(isMac
      ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 13 } }
      : {
          titleBarStyle: 'hidden',
          titleBarOverlay: { color: '#00000000', symbolColor: '#2b3f5c', height: TITLEBAR_HEIGHT },
        }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once('ready-to-show', () => win.show());

  // Links always open in the user's default browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isWebUrl(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (devUrl && url.startsWith(devUrl)) return;
    e.preventDefault();
    if (isWebUrl(url)) shell.openExternal(url);
  });

  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));

  win.on('closed', () => {
    win = null;
    // The private vault only stays open while the window is open.
    vault.lock();
  });
}

ipcMain.handle('store:load', () => readStore());
ipcMain.handle('store:save', (_e, data) => {
  writeStore(data);
  return true;
});
ipcMain.handle('clipboard:read', () => clipboard.readText());
ipcMain.handle('clipboard:write', (_e, text) => {
  clipboard.writeText(String(text ?? ''));
  return true;
});
ipcMain.handle('clipboard:readImage', () => readClipboardImage());
ipcMain.handle('clipboard:writeImage', (_e, ref, isPrivate) => {
  if (isPrivate) {
    const img = vault.readImage(ref);
    if (!img) return false;
    clipboard.writeImage(nativeImage.createFromBuffer(img.bytes));
    return true;
  }
  const file = imagePath(ref);
  if (!file || !fs.existsSync(file)) return false;
  clipboard.writeImage(nativeImage.createFromPath(file));
  return true;
});

ipcMain.handle('private:status', () => vault.status());

ipcMain.handle('sync:status', () => sync.status());
ipcMain.handle('sync:choose', async () => {
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a folder to sync ClipVault through',
    properties: ['openDirectory', 'createDirectory'],
  });
  return res.canceled ? null : res.filePaths[0];
});
// `root` is a cloud-drive folder; ClipVault keeps its files in a "ClipVault" subfolder there.
ipcMain.handle('sync:enable', (_e, root, data) => {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Invalid folder');
  const target = path.basename(root).toLowerCase() === 'clipvault' ? root : path.join(root, 'ClipVault');
  const merged = sync.enable(target, data);
  lastWritten = sync.readJson(dataFile()) ? fs.readFileSync(dataFile(), 'utf8') : null;
  watcher.start();
  return { data: merged, status: sync.status() };
});
ipcMain.handle('sync:disable', (_e, data) => {
  watcher.stop();
  const merged = sync.disable(data);
  lastWritten = fs.readFileSync(dataFile(), 'utf8');
  return { data: merged, status: sync.status() };
});
ipcMain.handle('sync:open', () => shell.openPath(sync.dataDir()));
ipcMain.handle('private:setup', (_e, pin) => vault.setup(pin));
ipcMain.handle('private:unlock', (_e, pin) => vault.unlock(pin));
ipcMain.handle('private:load', () => vault.load());
ipcMain.handle('private:save', (_e, data) => vault.save(data));
ipcMain.handle('private:lock', () => vault.lock());
ipcMain.handle('private:changePin', (_e, pin) => vault.changePin(pin));
ipcMain.handle('private:erase', () => vault.erase());
ipcMain.handle('private:adoptImage', (_e, info) => {
  const file = imagePath(info?.ref);
  if (!file || !fs.existsSync(file)) return null;
  return vault.adoptImage(file, info);
});
ipcMain.handle('private:exportImage', (_e, info) => {
  const img = vault.readImage(info?.ref);
  if (!img) return null;
  const native = nativeImage.createFromBuffer(img.bytes);
  return saveImage(native, img.ext, img.bytes);
});
ipcMain.handle('image:save', (_e, bytes, mime) => {
  const buffer = Buffer.from(bytes);
  const img = nativeImage.createFromBuffer(buffer);
  if (img.isEmpty()) return null;
  // Keep original bytes for formats nativeImage decodes natively; convert anything else to PNG.
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg' }[mime];
  return ext ? saveImage(img, ext, buffer) : saveImage(img);
});
ipcMain.handle('shell:open', (_e, url) => {
  if (isWebUrl(url)) shell.openExternal(url);
});
ipcMain.handle('app:info', () => ({ platform: process.platform, shortcut: QUICK_SAVE_SHORTCUT }));

function registerQuickSave() {
  const ok = globalShortcut.register(QUICK_SAVE_SHORTCUT, () => {
    const text = clipboard.readText();
    const image = text.trim() ? null : readClipboardImage();
    if (!text.trim() && !image) return;
    if (!win) createWindow();
    const payload = image ? { image } : { text };
    const send = () => win.webContents.send('quick-capture', payload);
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send);
    else send();
    if (Notification.isSupported()) {
      new Notification({
        title: 'Saved to ClipVault',
        body: image ? `Screenshot ${image.width}×${image.height}` : text.slice(0, 120),
        silent: true,
      }).show();
    }
  });
  if (!ok) console.warn(`Could not register global shortcut ${QUICK_SAVE_SHORTCUT}`);
}

// Only one ClipVault at a time: a second launch just focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on('second-instance', () => {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
});
if (process.platform === 'win32') app.setAppUserModelId('com.clipvault.app');

app.whenReady().then(() => {
  // Serves saved images to the UI as clipvault-img://local/<ref>; private (encrypted)
  // images are decrypted on the fly from clipvault-img://private/<ref> while unlocked.
  protocol.handle(IMAGE_SCHEME, (req) => {
    const url = new URL(req.url);
    const ref = decodeURIComponent(url.pathname.slice(1));
    if (url.hostname === 'private') {
      const img = vault.readImage(ref);
      return img
        ? new Response(img.bytes, { headers: { 'content-type': img.mime, 'cache-control': 'no-store' } })
        : new Response('Not found', { status: 404 });
    }
    const file = imagePath(ref);
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  registerQuickSave();
  watcher.start();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
