# ClipVault ☀️

A fancy clipboard vault for **Windows and macOS**. Save your favorite links and snippets, sort them into categories, and copy any of them back with one click. The UI is Apple-style frosted glass over a sky-blue background with peach sunlight coming through.

## Features

- **Save anything you copy:** paste anywhere in the window (`Ctrl/⌘ + V`), use the **Paste** button, or press **`Ctrl/⌘ + Shift + S` from any app** to save whatever is on your clipboard — text, links or **screenshots**.
- **Screenshots & images:** paste a screenshot (e.g. after `Win + Shift + S` or `⌘ + Ctrl + Shift + 4`), drag image files onto the window, or use **Add image** in the editor. Click the card to copy the image back; use ⤢ to view it full size. Images are stored as files in the app-data `images` folder.
- **Click a card's header (icon + title) to copy it** back to your clipboard. Copy counts drive the "Most used" sort.
- **Click anywhere else on a card to open it large** (80% of the window): see the full screenshot or text and edit the content, title, notes, category, tags and favorite. Changes save automatically; `Esc` closes.
- **Notes on every clip:** click the 🗒 icon on a card to write a note right there (`Ctrl/⌘ + Enter` saves, `Esc` cancels), or use the Notes box in the editor. Click an existing note to edit it. Notes are searchable and never copied with the clip. The **With Notes** view lists every clip that has one.
- **Categories** with emoji and color. Drag a card onto a category in the sidebar to file it. Hover a category to **edit** or **delete** it; deleting can be undone from the toast.
- **Smart views:** All, Favorites, Links, Snippets, Images, With Notes, Unsorted.
- **Private section (PIN-protected, encrypted):** click the small 🔒 in the bottom-right of the sidebar to create a 6-digit PIN or unlock. Anything saved while in **Private** — text, notes, screenshots — is encrypted on disk (AES-256-GCM). Use the 🔒 / 🔓 button on a card to move clips in or out. It stays unlocked until you press **Lock** or close the app. After 5 wrong PINs it locks out for 30 s, doubling each time. **If you forget the PIN, private clips cannot be recovered** ("Forgot PIN?" erases the private section).
  - The encryption key combines your PIN with a secret protected by your OS account (Windows DPAPI / macOS Keychain), so a copied vault file can't be cracked elsewhere. The private section therefore only opens on the same computer and user account.
- **Search** across titles, content, notes, categories and `#tags` (`Ctrl/⌘ + F`).
- Links are detected automatically and get a title from the URL. Clicking ↗ opens them in your browser.
- Deleting shows an undo toast. Saving something you already have just moves the existing clip to the top instead of duplicating it.
- Data is stored locally in `clipvault.json` in the OS app-data folder:
  - Windows: `%APPDATA%\ClipVault`
  - macOS: `~/Library/Application Support/ClipVault`

## Cloud sync (OneDrive, Google Drive, iCloud Drive, Dropbox…)

Click **Set up cloud sync** at the bottom of the sidebar. ClipVault detects installed cloud drives (OneDrive, Google Drive for desktop, iCloud Drive) and stores its data in a `ClipVault` folder inside the one you pick, or in any folder you choose. The provider's desktop app does the syncing; no sign-in inside ClipVault is needed.

- Do the same on your other computers; existing clips on each are merged in.
- Edits are merged clip by clip (newest edit wins). Deletions are remembered so deleted clips don't come back from another device.
- Changes from other computers appear automatically, and conflict copies created by sync clients (e.g. `clipvault-LAPTOP.json`) are merged and cleaned up.
- **Stop syncing** brings a full copy back to this computer and leaves the cloud copy untouched.
- The 🔒 **Private** section is never synced; it always stays on this computer.

## Shortcuts

| Action | Windows | macOS |
| --- | --- | --- |
| Save clipboard from any app | `Ctrl + Shift + S` | `⌘ + Shift + S` |
| Save by pasting into the window | `Ctrl + V` | `⌘ + V` |
| New clip | `Ctrl + N` | `⌘ + N` |
| Search | `Ctrl + F` | `⌘ + F` |
| Save in editor | `Ctrl + Enter` | `⌘ + Enter` |

## Development

Requires Node.js 20+. On Windows PowerShell, use `npm.cmd` if script execution is disabled.

```bash
npm install
npm run dev      # Vite + Electron with hot reload
npm run web      # UI only, in a browser (uses localStorage)
npm start        # production build, run in Electron
```

## Packaging

```bash
npm run dist:win   # Windows installer (NSIS) -> release/
npm run dist:mac   # macOS .dmg -> release/  (must be built on a Mac)
```

Add `build/icon.ico` (Windows) and `build/icon.icns` (macOS) to use a custom app icon.

## Project layout

```
electron/main.cjs      Main process: window, storage, clipboard, global shortcut, image protocol
electron/private-vault.cjs  Encrypted private section (PIN, scrypt, AES-256-GCM)
electron/sync.cjs      Cloud-folder sync: provider detection, migration, file watching, conflict copies
electron/merge.cjs     Clip-level merge with tombstones (mirrored in src/merge.ts)
electron/preload.cjs   Secure bridge exposed to the UI as window.clipvault
src/App.tsx            App state, search/sort, paste-to-save, persistence
src/components/        Sidebar, ClipCard, ClipEditor, Icon
src/styles.css         Sky / sunray / frosted-glass theme
```
