// Cloud sync via a folder that OneDrive / Google Drive / iCloud Drive (or anything else) syncs.
// ClipVault just reads/writes files there; the provider's desktop app moves them between devices.
const { app } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { mergeVaults } = require('./merge.cjs');

const DATA_NAME = 'clipvault.json';
// Conflict copies created by sync clients, e.g. "clipvault-DESKTOP-1.json", "clipvault (1).json".
const CONFLICT_RE = /^clipvault[ \-_(].*\.json$/i;
const IMAGE_RE = /^[a-f0-9-]{36}\.(png|jpe?g|gif|webp)$/i;

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeSettings(s) {
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(s, null, 2));
}

const localDir = () => app.getPath('userData');
const dataDir = () => readSettings().syncDir || localDir();
const isSyncing = () => Boolean(readSettings().syncDir);

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  const text = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, file);
  return text;
}

/** Folds sync-client conflict copies into the main data and removes them. */
function absorbConflicts(dir, data) {
  let merged = data;
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase() === DATA_NAME || !CONFLICT_RE.test(f)) continue;
      const other = readJson(path.join(dir, f));
      if (other && Array.isArray(other.clips)) {
        merged = mergeVaults(other, merged);
        fs.rmSync(path.join(dir, f), { force: true });
      }
    }
  } catch {}
  return merged;
}

function exists(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** Finds cloud-drive folders installed on this machine. */
function detectProviders() {
  const home = os.homedir();
  const found = [];
  const add = (id, name, root) => {
    if (root && exists(root) && !found.some((f) => f.path === root)) found.push({ id, name, path: root });
  };

  if (process.platform === 'win32') {
    add('onedrive', 'OneDrive', process.env.OneDriveConsumer);
    add('onedrive', 'OneDrive (work)', process.env.OneDriveCommercial);
    add('onedrive', 'OneDrive', process.env.OneDrive);
    // Google Drive for desktop mounts a virtual drive (usually G:) containing "My Drive".
    for (const letter of 'GHIJKLMNOPQRSTUVWXYZDEF') add('gdrive', 'Google Drive', `${letter}:\\My Drive`);
    add('gdrive', 'Google Drive', path.join(home, 'Google Drive'));
    add('gdrive', 'Google Drive', path.join(home, 'My Drive'));
    add('icloud', 'iCloud Drive', path.join(home, 'iCloudDrive'));
  } else if (process.platform === 'darwin') {
    const cloudStorage = path.join(home, 'Library', 'CloudStorage');
    try {
      for (const entry of fs.readdirSync(cloudStorage)) {
        if (entry.startsWith('OneDrive')) add('onedrive', entry.includes('-') && !entry.startsWith('OneDrive-Personal') ? `OneDrive (${entry.split('-').slice(1).join('-')})` : 'OneDrive', path.join(cloudStorage, entry));
        if (entry.startsWith('GoogleDrive')) add('gdrive', 'Google Drive', path.join(cloudStorage, entry, 'My Drive'));
      }
    } catch {}
    add('icloud', 'iCloud Drive', path.join(home, 'Library', 'Mobile Documents', 'com~apple~CloudDocs'));
    add('onedrive', 'OneDrive', path.join(home, 'OneDrive'));
  }
  return found;
}

function providerFor(dir) {
  if (!dir) return null;
  const match = detectProviders().find((p) => dir.toLowerCase().startsWith(p.path.toLowerCase()));
  return match ? match.name : 'Synced folder';
}

/** Copies image files that `to` doesn't have yet. Never deletes. */
function copyImages(fromDir, toDir) {
  const from = path.join(fromDir, 'images');
  const to = path.join(toDir, 'images');
  try {
    fs.mkdirSync(to, { recursive: true });
    for (const f of fs.readdirSync(from)) {
      if (IMAGE_RE.test(f) && !fs.existsSync(path.join(to, f))) fs.copyFileSync(path.join(from, f), path.join(to, f));
    }
  } catch {}
}

/** Moves the vault into `target`, merging with anything already there (e.g. from another computer). */
function enable(target, currentData) {
  fs.mkdirSync(target, { recursive: true });
  const from = dataDir();
  const there = absorbConflicts(target, readJson(path.join(target, DATA_NAME)));
  const merged = there ? mergeVaults(there, currentData) : mergeVaults({}, currentData);
  copyImages(from, target);
  writeJson(path.join(target, DATA_NAME), merged);
  writeSettings({ ...readSettings(), syncDir: target });
  return merged;
}

/** Stops syncing: brings a full copy back to this computer. The cloud copy is left untouched. */
function disable(currentData) {
  const from = dataDir();
  const local = localDir();
  const merged = mergeVaults(readJson(path.join(local, DATA_NAME)) || {}, currentData);
  if (path.resolve(from) !== path.resolve(local)) copyImages(from, local);
  writeJson(path.join(local, DATA_NAME), merged);
  const s = readSettings();
  delete s.syncDir;
  writeSettings(s);
  return merged;
}

/** Watches the sync folder and calls `onRemoteChange` when another device updates it. */
function createWatcher(getLastWritten, onRemoteChange) {
  let watcher = null;
  let timer = null;

  const check = () => {
    const dir = dataDir();
    const file = path.join(dir, DATA_NAME);
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      return;
    }
    const hasConflicts = (() => {
      try {
        return fs.readdirSync(dir).some((f) => f.toLowerCase() !== DATA_NAME && CONFLICT_RE.test(f));
      } catch {
        return false;
      }
    })();
    if (text === getLastWritten() && !hasConflicts) return;
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return; // mid-write by the sync client; we'll get another event
    }
    onRemoteChange(absorbConflicts(dir, data));
  };

  return {
    start() {
      this.stop();
      if (!isSyncing()) return;
      try {
        watcher = fs.watch(dataDir(), (_event, name) => {
          if (name && !/\.json$/i.test(name)) return;
          clearTimeout(timer);
          timer = setTimeout(check, 800);
        });
      } catch {}
    },
    stop() {
      clearTimeout(timer);
      if (watcher) watcher.close();
      watcher = null;
    },
    check,
  };
}

module.exports = {
  DATA_NAME,
  dataDir,
  isSyncing,
  readJson,
  writeJson,
  absorbConflicts,
  detectProviders,
  providerFor,
  enable,
  disable,
  createWatcher,
  status() {
    const dir = isSyncing() ? dataDir() : null;
    return { syncing: Boolean(dir), dir, provider: providerFor(dir), detected: detectProviders() };
  },
};
