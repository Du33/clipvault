// Encrypted private vault.
//
// Layout on disk (userData):
//   private.vault        JSON header + AES-256-GCM encrypted clip data
//   private-images/      AES-256-GCM encrypted image files (<uuid>.<ext>.enc)
//   private.lock.json    failed-attempt counter for PIN lockout
//
// Keys: a random data key (DEK) encrypts everything. The DEK is wrapped with a key derived via
// scrypt from the 6-digit PIN plus a random "pepper". The pepper is protected by the OS
// (safeStorage: DPAPI on Windows, Keychain on macOS), so a copied vault file can't be
// brute-forced on another machine. Changing the PIN only re-wraps the DEK.
const { app, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const PIN_RE = /^\d{6}$/;
const REF_RE = /^[a-f0-9-]{36}\.(png|jpe?g|gif|webp)$/i;
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const FREE_ATTEMPTS = 5;
const MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };

let dek = null; // Buffer while unlocked

const dir = () => app.getPath('userData');
const vaultFile = () => path.join(dir(), 'private.vault');
const lockFile = () => path.join(dir(), 'private.lock.json');
const imagesDir = () => path.join(dir(), 'private-images');
const imageFile = (ref) => (REF_RE.test(ref) ? path.join(imagesDir(), `${ref}.enc`) : null);

function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), body]);
}

function open(key, sealed) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, sealed.subarray(0, 12));
  d.setAuthTag(sealed.subarray(12, 28));
  return Buffer.concat([d.update(sealed.subarray(28)), d.final()]);
}

function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}

function readHeader() {
  try {
    return JSON.parse(fs.readFileSync(vaultFile(), 'utf8'));
  } catch {
    return null;
  }
}

function deriveKek(pin, salt, pepper) {
  return new Promise((resolve, reject) =>
    crypto.scrypt(Buffer.concat([Buffer.from(pin, 'utf8'), pepper]), salt, 32, SCRYPT, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

function makePepper() {
  const pepper = crypto.randomBytes(32);
  const protectedPepper = safeStorage.isEncryptionAvailable()
    ? { os: true, value: safeStorage.encryptString(pepper.toString('base64')).toString('base64') }
    : { os: false, value: pepper.toString('base64') };
  return { pepper, protectedPepper };
}

function unprotectPepper(p) {
  if (!p) return Buffer.alloc(0);
  return p.os ? Buffer.from(safeStorage.decryptString(Buffer.from(p.value, 'base64')), 'base64') : Buffer.from(p.value, 'base64');
}

function readLock() {
  try {
    return JSON.parse(fs.readFileSync(lockFile(), 'utf8'));
  } catch {
    return { fails: 0, lockedUntil: 0 };
  }
}

function saveData(data) {
  const header = readHeader();
  header.data = seal(dek, Buffer.from(JSON.stringify(data), 'utf8')).toString('base64');
  writeAtomic(vaultFile(), JSON.stringify(header));
}

function loadData(header = readHeader()) {
  return JSON.parse(open(dek, Buffer.from(header.data, 'base64')).toString('utf8'));
}

function pruneImages(data) {
  try {
    const used = new Set((data.clips ?? []).map((c) => c.image?.private && c.image.ref).filter(Boolean));
    for (const f of fs.readdirSync(imagesDir())) {
      const ref = f.replace(/\.enc$/, '');
      if (!used.has(ref)) fs.rmSync(path.join(imagesDir(), f), { force: true });
    }
  } catch {}
}

function requireUnlocked() {
  if (!dek) throw new Error('Private vault is locked');
}

module.exports = {
  isUnlocked: () => Boolean(dek),

  status() {
    const lock = readLock();
    return { supported: true, exists: Boolean(readHeader()), unlocked: Boolean(dek), lockedUntil: lock.lockedUntil || 0 };
  },

  async setup(pin) {
    if (!PIN_RE.test(String(pin))) throw new Error('PIN must be 6 digits');
    if (readHeader()) throw new Error('A private vault already exists');
    const salt = crypto.randomBytes(16);
    const { pepper, protectedPepper } = makePepper();
    const newDek = crypto.randomBytes(32);
    const kek = await deriveKek(String(pin), salt, pepper);
    const header = {
      version: 1,
      kdf: { name: 'scrypt', ...SCRYPT, maxmem: undefined, salt: salt.toString('base64') },
      pepper: protectedPepper,
      wrappedKey: seal(kek, newDek).toString('base64'),
      data: '',
    };
    dek = newDek;
    writeAtomic(vaultFile(), JSON.stringify(header));
    const data = { version: 1, clips: [] };
    saveData(data);
    fs.rmSync(lockFile(), { force: true });
    return data;
  },

  async unlock(pin) {
    const header = readHeader();
    if (!header) return { ok: false, error: 'No private vault' };
    const lock = readLock();
    if (lock.lockedUntil > Date.now()) return { ok: false, lockedUntil: lock.lockedUntil, attemptsLeft: 0 };
    try {
      const kek = await deriveKek(String(pin), Buffer.from(header.kdf.salt, 'base64'), unprotectPepper(header.pepper));
      dek = open(kek, Buffer.from(header.wrappedKey, 'base64'));
    } catch {
      const fails = (lock.fails || 0) + 1;
      const over = fails - FREE_ATTEMPTS;
      // 30s, 60s, 2m, 4m … capped at 1 hour.
      const lockedUntil = over >= 0 ? Date.now() + Math.min(30_000 * 2 ** over, 3_600_000) : 0;
      writeAtomic(lockFile(), JSON.stringify({ fails, lockedUntil }));
      return { ok: false, attemptsLeft: Math.max(0, FREE_ATTEMPTS - fails), lockedUntil };
    }
    fs.rmSync(lockFile(), { force: true });
    const data = loadData(header);
    pruneImages(data);
    return { ok: true, data };
  },

  load() {
    requireUnlocked();
    return loadData();
  },

  save(data) {
    requireUnlocked();
    saveData(data);
    return true;
  },

  lock() {
    if (dek) dek.fill(0);
    dek = null;
  },

  async changePin(newPin) {
    requireUnlocked();
    if (!PIN_RE.test(String(newPin))) throw new Error('PIN must be 6 digits');
    const header = readHeader();
    const salt = crypto.randomBytes(16);
    const { pepper, protectedPepper } = makePepper();
    const kek = await deriveKek(String(newPin), salt, pepper);
    header.kdf.salt = salt.toString('base64');
    header.pepper = protectedPepper;
    header.wrappedKey = seal(kek, dek).toString('base64');
    writeAtomic(vaultFile(), JSON.stringify(header));
    return true;
  },

  erase() {
    module.exports.lock();
    fs.rmSync(vaultFile(), { force: true });
    fs.rmSync(lockFile(), { force: true });
    fs.rmSync(imagesDir(), { recursive: true, force: true });
    return true;
  },

  /** Encrypts a plain image file into the vault and deletes the plain copy. */
  adoptImage(plainPath, info) {
    requireUnlocked();
    const ref = `${crypto.randomUUID()}${path.extname(plainPath).toLowerCase()}`;
    writeAtomic(imageFile(ref), seal(dek, fs.readFileSync(plainPath)));
    fs.rmSync(plainPath, { force: true });
    return { ref, width: info.width, height: info.height, private: true };
  },

  /** Decrypted image bytes + mime, or null. */
  readImage(ref) {
    if (!dek) return null;
    const file = typeof ref === 'string' ? imageFile(ref) : null;
    if (!file || !fs.existsSync(file)) return null;
    const ext = path.extname(ref).slice(1).toLowerCase();
    return { bytes: open(dek, fs.readFileSync(file)), mime: MIME[ext] ?? 'application/octet-stream', ext };
  },
};
