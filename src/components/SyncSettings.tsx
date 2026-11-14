import { useEffect, useState } from 'react';
import type { SyncProvider, SyncStatus } from '../api';
import { Icon } from './Icon';

type Props = {
  status: SyncStatus | null;
  onEnable: (root: string) => Promise<void>;
  onChooseFolder: () => Promise<void>;
  onDisable: () => Promise<void>;
  onOpenFolder: () => void;
  onClose: () => void;
};

const PROVIDERS: { id: SyncProvider['id']; name: string; logo: string; hint: string }[] = [
  { id: 'onedrive', name: 'OneDrive', logo: '☁️', hint: 'Install OneDrive and sign in, then reopen this panel.' },
  { id: 'gdrive', name: 'Google Drive', logo: '🟢', hint: 'Install “Google Drive for desktop” and sign in.' },
  { id: 'icloud', name: 'iCloud Drive', logo: '🍏', hint: 'Turn on iCloud Drive (on Windows: install iCloud for Windows).' },
];

export function SyncSettings({ status, onEnable, onChooseFolder, onDisable, onOpenFolder, onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !busy && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setError('');
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Something went wrong');
    } finally {
      setBusy(null);
    }
  };

  const detected = status?.detected ?? [];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <section className="modal glass-strong settings" role="dialog" aria-label="Settings">
        <header className="modal-head">
          <h2>Cloud sync</h2>
          <button className="icon-btn" onClick={onClose} title="Close" disabled={!!busy}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className={`sync-status${status?.syncing ? ' on' : ''}`}>
          <div className="sync-status-icon">{status?.syncing ? '☁️' : '💻'}</div>
          <div className="sync-status-text">
            <strong>{status?.syncing ? `Syncing via ${status.provider}` : 'Saved on this computer only'}</strong>
            <span className="truncate" title={status?.dir ?? undefined}>
              {status?.syncing ? status.dir : 'Pick a cloud drive below to use ClipVault on all your computers.'}
            </span>
          </div>
          {status?.syncing && (
            <button className="btn glass small" onClick={onOpenFolder}>
              Show folder
            </button>
          )}
        </div>

        <div className="provider-list">
          {PROVIDERS.map((p) => {
            const found = detected.filter((d) => d.id === p.id);
            return (
              <div key={p.id} className="provider">
                <span className="provider-logo">{p.logo}</span>
                <div className="provider-text">
                  <strong>{p.name}</strong>
                  <span className="truncate">{found.length ? found.map((f) => f.path).join(' · ') : p.hint}</span>
                </div>
                {found.length ? (
                  found.map((f) => {
                    const active = !!status?.dir && status.dir.toLowerCase().startsWith(f.path.toLowerCase());
                    return active ? (
                      <span key={f.path} className="provider-active">
                        <Icon name="check" size={14} /> In use
                      </span>
                    ) : (
                      <button
                        key={f.path}
                        className="btn primary small"
                        disabled={!!busy}
                        onClick={() => run(f.path, () => onEnable(f.path))}
                        title={`Store ClipVault in ${f.path}\\ClipVault`}
                      >
                        {busy === f.path ? 'Moving…' : found.length > 1 ? `Use ${f.name}` : 'Use'}
                      </button>
                    );
                  })
                ) : (
                  <span className="provider-missing">Not found</span>
                )}
              </div>
            );
          })}
        </div>

        <div className="settings-row">
          <button className="link-btn" disabled={!!busy} onClick={() => run('choose', onChooseFolder)}>
            <Icon name="folder" size={13} /> Choose another folder (Dropbox, network drive…)
          </button>
          {status?.syncing && (
            <button className="link-btn danger" disabled={!!busy} onClick={() => run('disable', onDisable)}>
              Stop syncing
            </button>
          )}
        </div>

        {error && <div className="settings-error">{error}</div>}

        <ul className="settings-notes">
          <li>Clips, notes, categories and screenshots sync. Edits from different computers are merged clip by clip.</li>
          <li>
            🔒 The <b>Private</b> section always stays on this computer and is never uploaded.
          </li>
          <li>If you already use ClipVault on another computer with the same drive, its clips are merged in.</li>
        </ul>
      </section>
    </div>
  );
}
