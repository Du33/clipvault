import { useEffect, useRef, useState, type ClipboardEvent } from 'react';
import { api, imageUrl, saveImageFromTransfer } from '../api';
import type { Category, Clip, ClipDraft, ImageInfo } from '../types';
import { guessTitle, imageTitle, isLink, parseTags } from '../utils';
import { Icon } from './Icon';

type Props = {
  clip: Clip | null;
  initialContent?: string;
  initialImage?: ImageInfo;
  defaultCategoryId: string | null;
  categories: Category[];
  onSave: (draft: ClipDraft) => void;
  onClose: () => void;
};

export function ClipEditor({ clip, initialContent = '', initialImage, defaultCategoryId, categories, onSave, onClose }: Props) {
  const [content, setContent] = useState(clip?.content ?? initialContent);
  const [image, setImage] = useState<ImageInfo | null>(clip ? clip.image : initialImage ?? null);
  const [title, setTitle] = useState(clip?.title ?? '');
  const [note, setNote] = useState(clip?.note ?? '');
  const [categoryId, setCategoryId] = useState<string | null>(clip ? clip.categoryId : defaultCategoryId);
  const [tags, setTags] = useState(clip?.tags.join(', ') ?? '');
  const [favorite, setFavorite] = useState(clip?.favorite ?? false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const autoTitle = () => (image && !content.trim() ? imageTitle() : guessTitle(content));

  const canSave = content.trim().length > 0 || Boolean(image);
  const submit = () => {
    if (!canSave) return;
    onSave({
      content,
      image,
      title: title.trim() || autoTitle(),
      note: note.trim(),
      categoryId,
      tags: parseTags(tags),
      favorite,
    });
  };

  const onPasteImage = async (e: ClipboardEvent) => {
    const dt = e.clipboardData;
    if (dt.getData('text/plain').trim()) return;
    if (!Array.from(dt.items).some((i) => i.kind === 'file' && i.type.startsWith('image/'))) return;
    e.preventDefault();
    const saved = await saveImageFromTransfer(dt);
    if (saved) setImage(saved);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="modal glass-strong"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit();
        }}
        onPaste={onPasteImage}
      >
        <header className="modal-head">
          <h2>{clip ? 'Edit clip' : 'New clip'}</h2>
          <button type="button" className="icon-btn" onClick={onClose} title="Close">
            <Icon name="close" size={16} />
          </button>
        </header>

        {image ? (
          <div className="editor-image">
            <img src={imageUrl(image)} alt="" />
            <div className="editor-image-meta">
              <span>
                <Icon name="image" size={14} /> {image.width} × {image.height}
              </span>
              <button type="button" className="btn small" onClick={() => fileRef.current?.click()}>
                Replace
              </button>
              <button type="button" className="btn small" onClick={() => setImage(null)}>
                Remove
              </button>
            </div>
          </div>
        ) : null}

        <label className="lbl">
          <span className="lbl-row">
            {image ? 'Text (optional)' : 'Content'}
            {!image && (
              <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>
                <Icon name="image" size={13} /> Add image
              </button>
            )}
          </span>
          <textarea
            autoFocus
            className="field area"
            rows={image ? 2 : 4}
            placeholder={image ? 'Any text to keep alongside the image…' : 'Paste a link, text or a screenshot…'}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
        </label>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const saved = await api.saveImage(new Uint8Array(await f.arrayBuffer()), f.type);
            if (saved) setImage(saved);
          }}
        />

        <label className="lbl">
          Title
          <input
            className="field"
            placeholder={content.trim() || image ? autoTitle() : 'Auto-generated if left blank'}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>

        <div className="row2">
          <label className="lbl">
            Category
            <select className="field" value={categoryId ?? ''} onChange={(e) => setCategoryId(e.target.value || null)}>
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
            <input className="field" placeholder="design, ideas" value={tags} onChange={(e) => setTags(e.target.value)} />
          </label>
        </div>

        <label className="lbl">
          Notes
          <textarea
            className="field area note-area"
            rows={4}
            placeholder="Add context, instructions, reminders — anything you want to remember with this clip"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>

        <footer className="modal-foot">
          <button type="button" className={`toggle${favorite ? ' on' : ''}`} onClick={() => setFavorite((f) => !f)}>
            <Icon name="star" size={15} filled={favorite} /> Favorite
          </button>
          <span className="hint">
            {image ? '🖼️ Image clip' : isLink(content) ? '🔗 Link detected' : content.trim() ? '📝 Text snippet' : ''}
          </span>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!canSave}>
            {clip ? 'Save changes' : 'Save clip'}
          </button>
        </footer>
      </form>
    </div>
  );
}
