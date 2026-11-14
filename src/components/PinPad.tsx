import { useCallback, useEffect, useState } from 'react';
import { Icon } from './Icon';

export type PinMode = 'setup' | 'unlock' | 'change';

type Props = {
  mode: PinMode;
  lockedUntil: number;
  /** Return an error message to show (and reset), or null on success. */
  onSubmit: (pin: string) => Promise<string | null>;
  onErase?: () => Promise<void>;
  onClose: () => void;
};

const LENGTH = 6;
const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'back'];

export function PinPad({ mode, lockedUntil, onSubmit, onErase, onClose }: Props) {
  const [pin, setPin] = useState('');
  const [first, setFirst] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [erasing, setErasing] = useState(false);
  const [eraseText, setEraseText] = useState('');

  const locked = lockedUntil > now;
  const confirming = mode !== 'unlock' && first !== null;

  useEffect(() => {
    if (!locked) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [locked]);

  const fail = (msg: string) => {
    setError(msg);
    setShake((s) => s + 1);
    setPin('');
  };

  const complete = useCallback(
    async (value: string) => {
      if (mode !== 'unlock' && first === null) {
        setFirst(value);
        setPin('');
        setError('');
        return;
      }
      if (mode !== 'unlock' && value !== first) {
        setFirst(null);
        fail("PINs didn't match — try again");
        return;
      }
      setBusy(true);
      const err = await onSubmit(value);
      setBusy(false);
      if (err) fail(err);
    },
    [mode, first, onSubmit],
  );

  const press = useCallback(
    (key: string) => {
      if (busy || locked || erasing) return;
      if (key === 'back') {
        setPin((p) => p.slice(0, -1));
        return;
      }
      if (!/^\d$/.test(key)) return;
      setError('');
      setPin((p) => {
        if (p.length >= LENGTH) return p;
        const next = p + key;
        if (next.length === LENGTH) setTimeout(() => complete(next), 120);
        return next;
      });
    },
    [busy, locked, erasing, complete],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (erasing) return;
      if (e.key === 'Escape') onClose();
      else if (e.key === 'Backspace') press('back');
      else if (/^\d$/.test(e.key)) press(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press, onClose, erasing]);

  const title =
    mode === 'unlock' ? 'Enter your PIN' : confirming ? 'Confirm your PIN' : mode === 'change' ? 'Choose a new PIN' : 'Create a 6-digit PIN';
  const subtitle =
    mode === 'unlock'
      ? 'Your private clips are encrypted with it.'
      : confirming
        ? 'Enter the same 6 digits again.'
        : 'Private clips are encrypted with this PIN. If you forget it, they cannot be recovered.';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pin-sheet glass-strong" role="dialog" aria-label={title}>
        <button className="icon-btn pin-close" onClick={onClose} title="Close">
          <Icon name="close" size={16} />
        </button>
        <div className="pin-lock">
          <Icon name="lock" size={22} />
        </div>

        {erasing ? (
          <div className="pin-erase">
            <h2>Erase private vault?</h2>
            <p>This permanently deletes every private clip and image. Type <b>ERASE</b> to confirm.</p>
            <input autoFocus className="field" value={eraseText} onChange={(e) => setEraseText(e.target.value)} placeholder="ERASE" />
            <div className="pin-erase-actions">
              <button className="btn small" onClick={() => setErasing(false)}>
                Cancel
              </button>
              <button
                className="btn danger small"
                disabled={eraseText !== 'ERASE'}
                onClick={async () => {
                  await onErase?.();
                }}
              >
                Erase everything
              </button>
            </div>
          </div>
        ) : (
          <>
            <h2>{title}</h2>
            <p className="pin-sub">{subtitle}</p>

            <div key={shake} className={`pin-dots${shake ? ' shake' : ''}`}>
              {Array.from({ length: LENGTH }, (_, i) => (
                <span key={i} className={i < pin.length ? 'on' : ''} />
              ))}
            </div>

            <div className="pin-msg">
              {locked ? (
                <span className="err">Too many attempts. Try again in {Math.ceil((lockedUntil - now) / 1000)}s</span>
              ) : busy ? (
                <span>Unlocking…</span>
              ) : (
                error && <span className="err">{error}</span>
              )}
            </div>

            <div className="pin-keys">
              {KEYS.map((k, i) =>
                k ? (
                  <button key={i} className={`pin-key${k === 'back' ? ' back' : ''}`} onClick={() => press(k)} disabled={busy || locked}>
                    {k === 'back' ? <Icon name="backspace" size={20} /> : k}
                  </button>
                ) : (
                  <span key={i} />
                ),
              )}
            </div>

            {mode === 'unlock' && onErase && (
              <button className="pin-forgot" onClick={() => setErasing(true)}>
                Forgot PIN?
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
