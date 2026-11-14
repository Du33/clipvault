import { useCallback, useEffect, useRef, useState } from 'react';
import { imageUrl } from '../api';
import type { Category, Clip } from '../types';
import { clipKind, domainOf, guessTitle, imageTitle, parseTags, timeAgo } from '../utils';
import { Icon } from './Icon';

type Patch = Partial<Pick<Clip, 'title' | 'content' | 'note' | 'tags' | 'categoryId' | 'favorite'>>;

type Props = {
  clip: Clip;
  categories: Category[];
  isPrivate: boolean;
  onChange: (patch: Patch) => void;
  onCopy: (clip: Clip) => void;
  onOpenLink: (url: string) => void;
  onPreviewImage: () => void;
  onDelete: () => void;
  onClose: () => void;
  privacyAction?: { kind: 'in' | 'out'; run: () => void };
};

type Draft = { title: string; content: string; note: string; tags: string; categoryId: string | null; favorite: boolean };

const toDraft = (c: Clip): Draft => ({
  title: c.title,
  content: c.content,
  note: c.note,
  tags: c.tags.join(', '),
  categoryId: c.categoryId,
  favorite: c.favorite,
});

/** Large editor for a single clip. Edits auto-save shortly after you stop typing. */
export function ClipDetail({ clip, categories, isPrivate, onChange, onCopy, onOpenLink, onPreviewImage, onDelete, onClose, privacyAction }: Props) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(clip));
  const [saved, setSaved] = useState(true);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const clipRef = useRef(clip);
  clipRef.current = clip;

  const kind = clipKind({ image: clip.image, content: draft.content });
  const link = kind === 'link';

  const toPatch = useCallback((d: Draft): Patch => {
    const c = clipRef.current;
    const patch: Patch = {};
    const title = d.title.trim() || (c.image && !d.content.trim() ? imageTitle(c.createdAt) : guessTitle(d.content));
    const tags = parseTags(d.tags);
    if (title !== c.title) patch.title = title;
    if (d.content !== c.content) patch.content = d.content;
    if (d.note.trim() !== c.note) patch.note = d.note.trim();
    if (tags.join(',') !== c.tags.join(',')) patch.tags = tags;
    if (d.categoryId !== c.categoryId) patch.categoryId = d.categoryId;
    if (d.favorite !== c.favorite) patch.favorite = d.favorite;
    return patch;
  }, []);

  const flush = useCallback(() => {
    const patch = toPatch(draftRef.current);
    // A clip needs either text or an image; ignore emptying a text-only clip.
    if (patch.content !== undefined && !patch.content.trim() && !clipRef.current.image) delete patch.content;
    if (Object.keys(patch).length) onChange(patch);
    setSaved(true);
    return patch;
  }, [onChange, toPatch]);

  useEffect(() => {
    if (saved) return;
    const t = setTimeout(flush, 450);
    return () => clearTimeout(t);
  }, [draft, saved, flush]);

  const close = useCallback(() => {
    flush();
    onClose();
  }, [flush, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Let an open full-size image preview close first.
        if (document.querySelector('.lightbox')) return;
        e.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setSaved(false);
  };

  const copy = () => {
    const patch = flush();
    onCopy({ ...clipRef.current, ...patch });
  };

  return (
    <div className="modal-backdrop detail-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <section className="detail glass-strong" role="dialog" aria-label={draft.title || 'Clip'}>
        <header className="detail-head">
          <div className={`card-icon is-${kind}`}>
            {link ? <span>{(domainOf(draft.content)[0] ?? '#').toUpperCase()}</span> : <Icon name={kind === 'image' ? 'image' : 'text'} size={16} />}
          </div>
          <input
            className="detail-title"
            value={draft.title}
            placeholder="Untitled"
            onChange={(e) => set('title', e.target.value)}
            aria-label="Title"
          />
          <span className={`detail-saved${saved ? ' on' : ''}`}>{saved ? 'Saved' : 'Editing…'}</span>
          <button className="btn primary small" onClick={copy} title="Copy to clipboard">
            <Icon name="copy" size={14} /> Copy
          </button>
          <button className="icon-btn" onClick={close} title="Close (Esc)">
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="detail-body">
          <div className="detail-main">
            {clip.image && (
              <div className="detail-image" onClick={onPreviewImage} title="View full size">
                <img src={imageUrl(clip.image)} alt={draft.title} />
                <span className="detail-image-hint">
                  <Icon name="expand" size={13} /> {clip.image.width} × {clip.image.height}
                </span>
              </div>
            )}
            {link && (
              <div className="detail-link">
                <Icon name="link" size={14} />
                <span className="truncate">{domainOf(draft.content)}</span>
                <button className="btn glass small" onClick={() => onOpenLink(draft.content)}>
                  <Icon name="external" size={13} /> Open
                </button>
              </div>
            )}
            <label className={`detail-content${clip.image ? ' compact' : ''}`}>
              <span className="lbl-text">{clip.image ? 'Text' : 'Content'}</span>
              <textarea
                className={`field area${link ? ' mono' : ''}`}
                value={draft.content}
                placeholder={clip.image ? 'Add text to keep with this image…' : 'Clip content'}
                onChange={(e) => set('content', e.target.value)}
              />
            </label>
          </div>

          <aside className="detail-side">
            <label className="lbl detail-notes">
              <span className="lbl-row">
                <span>
                  <Icon name="note" size={13} /> Notes
                </span>
              </span>
              <textarea
                className="field area note-area"
                value={draft.note}
                placeholder="Why you saved this, how to use it, reminders…"
                onChange={(e) => set('note', e.target.value)}
              />
            </label>

            <label className="lbl">
              Category
              <select className="field" value={draft.categoryId ?? ''} onChange={(e) => set('categoryId', e.target.value || null)}>
                <option value="">Unsorted</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.emoji} {c.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="lbl">
              Tags
              <input className="field" value={draft.tags} placeholder="design, ideas" onChange={(e) => set('tags', e.target.value)} />
            </label>

            <button className={`toggle${draft.favorite ? ' on' : ''}`} onClick={() => set('favorite', !draft.favorite)}>
              <Icon name="star" size={15} filled={draft.favorite} /> {draft.favorite ? 'Favorite' : 'Add to favorites'}
            </button>

            <dl className="detail-meta">
              <div>
                <dt>Created</dt>
                <dd>{new Date(clip.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Edited</dt>
                <dd>{timeAgo(clip.updatedAt)}</dd>
              </div>
              <div>
                <dt>Copied</dt>
                <dd>{clip.copyCount}×</dd>
              </div>
              {isPrivate && (
                <div>
                  <dt>Storage</dt>
                  <dd>🔒 Encrypted</dd>
                </div>
              )}
            </dl>

            <div className="detail-actions">
              {privacyAction && (
                <button
                  className="btn glass small"
                  onClick={() => {
                    flush();
                    privacyAction.run();
                    onClose();
                  }}
                >
                  <Icon name={privacyAction.kind === 'in' ? 'lock' : 'unlock'} size={13} />
                  {privacyAction.kind === 'in' ? 'Move to Private' : 'Move out'}
                </button>
              )}
              <span className="spacer" />
              <button
                className="btn small danger"
                onClick={() => {
                  flush();
                  onDelete();
                }}
              >
                <Icon name="trash" size={13} /> Delete
              </button>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
