import { useEffect, useRef, useState } from 'react';
import { imageUrl } from '../api';
import type { Category, Clip } from '../types';
import { clipKind, domainOf, timeAgo } from '../utils';
import { Icon } from './Icon';

type Props = {
  clip: Clip;
  category?: Category;
  justCopied: boolean;
  onCopy: () => void;
  onOpen: () => void;
  onPreview: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  onTag: (tag: string) => void;
  onSaveNote: (note: string) => void;
  privacyAction?: { kind: 'in' | 'out'; run: () => void };
};

export function ClipCard(props: Props) {
  const { clip, category, justCopied, onCopy, onOpen, onEdit, onDelete, onToggleFavorite, onTag } = props;
  const kind = clipKind(clip);
  const link = kind === 'link';
  const domain = link ? domainOf(clip.content) : '';
  const [editingNote, setEditingNote] = useState(false);

  return (
    <article
      className={`card glass${justCopied ? ' copied' : ''}${editingNote ? ' editing' : ''}`}
      draggable={!editingNote}
      onDragStart={(e) => {
        e.dataTransfer.setData('application/x-clip-id', clip.id);
        if (clip.content) e.dataTransfer.setData('text/plain', clip.content);
        e.dataTransfer.effectAllowed = 'copyMove';
      }}
      onClick={() => !editingNote && onEdit()}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
          e.preventDefault();
          onCopy();
        }
      }}
      tabIndex={0}
      title={editingNote ? undefined : 'Click to open'}
    >
      <header
        className="card-head"
        title={kind === 'image' ? 'Click to copy image' : 'Click to copy'}
        onClick={(e) => {
          e.stopPropagation();
          if (!editingNote) onCopy();
        }}
      >
        <div className={`card-icon is-${kind}`}>
          {link ? <span>{(domain[0] ?? '#').toUpperCase()}</span> : <Icon name={kind === 'image' ? 'image' : 'text'} size={16} />}
          <span className="copy-badge">
            <Icon name={justCopied ? 'check' : 'copy'} size={15} />
          </span>
        </div>
        <div className="card-title-wrap">
          <h3 className="card-title">{clip.title}</h3>
          <div className="card-meta">
            <span className="meta-default">
              {link ? domain : clip.image ? `${clip.image.width} × ${clip.image.height}` : `${clip.content.length} chars`}
              <span className="dot">·</span>
              {timeAgo(clip.createdAt)}
              {clip.copyCount > 0 && (
                <>
                  <span className="dot">·</span>
                  copied {clip.copyCount}×
                </>
              )}
            </span>
            <span className="meta-hint">{justCopied ? 'Copied!' : kind === 'image' ? 'Click to copy image' : 'Click to copy'}</span>
          </div>
        </div>
        <button
          className={`icon-btn fav${clip.favorite ? ' on' : ''}`}
          title={clip.favorite ? 'Unfavorite' : 'Favorite'}
          onClick={(e) => {
            e.stopPropagation();
            onToggleFavorite();
          }}
        >
          <Icon name="star" size={16} filled={clip.favorite} />
        </button>
      </header>

      {clip.image && (
        <div className="card-image">
          <img src={imageUrl(clip.image)} alt={clip.title} loading="lazy" draggable={false} />
          <button
            className="icon-btn expand"
            title="View full size"
            onClick={(e) => {
              e.stopPropagation();
              props.onPreview();
            }}
          >
            <Icon name="expand" size={14} />
          </button>
        </div>
      )}
      {clip.content.trim() && <div className={`card-body${link ? ' mono-link' : ''}`}>{clip.content}</div>}

      {editingNote ? (
        <NoteEditor
          initial={clip.note}
          onDone={(note) => {
            setEditingNote(false);
            if (note !== null && note !== clip.note) props.onSaveNote(note);
          }}
        />
      ) : clip.note ? (
        <div
          className="card-note"
          title="Click to edit note"
          onClick={(e) => {
            e.stopPropagation();
            setEditingNote(true);
          }}
        >
          <Icon name="note" size={13} />
          <p>{clip.note}</p>
        </div>
      ) : null}

      <footer className="card-foot">
        <div className="chips">
          {category && (
            <span className={`chip cat c-${category.color}`}>
              {category.emoji} {category.name}
            </span>
          )}
          {clip.tags.map((t) => (
            <button
              key={t}
              className="chip tag"
              onClick={(e) => {
                e.stopPropagation();
                onTag(t);
              }}
            >
              #{t}
            </button>
          ))}
        </div>
        <div className="card-actions" onClick={(e) => e.stopPropagation()}>
          <button
            className={`icon-btn${clip.note ? ' has-note' : ''}`}
            title={clip.note ? 'Edit note' : 'Add note'}
            onClick={() => setEditingNote(true)}
          >
            <Icon name="note" size={15} />
          </button>
          {link && (
            <button className="icon-btn" title="Open in browser" onClick={onOpen}>
              <Icon name="external" size={15} />
            </button>
          )}
          <button className="icon-btn" title="Open & edit" onClick={onEdit}>
            <Icon name="edit" size={15} />
          </button>
          {props.privacyAction && (
            <button
              className="icon-btn private-toggle"
              title={props.privacyAction.kind === 'in' ? 'Move to Private' : 'Move out of Private'}
              onClick={props.privacyAction.run}
            >
              <Icon name={props.privacyAction.kind === 'in' ? 'lock' : 'unlock'} size={15} />
            </button>
          )}
          <button className="icon-btn danger" title="Delete" onClick={onDelete}>
            <Icon name="trash" size={15} />
          </button>
          <button className="icon-btn copy" title="Copy" onClick={onCopy}>
            <Icon name={justCopied ? 'check' : 'copy'} size={15} />
          </button>
        </div>
      </footer>
    </article>
  );
}

/** Inline note editor. `onDone(null)` means cancelled. */
function NoteEditor({ initial, onDone }: { initial: string; onDone: (note: string | null) => void }) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);

  const finish = (note: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(note === null ? null : note.trim());
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div className="note-editor" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <textarea
        ref={ref}
        className="note-input"
        rows={3}
        placeholder="Write a note… why you saved this, how to use it, reminders"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onBlur={() => finish(value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            finish(null);
          } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            finish(value);
          }
        }}
      />
      <div className="note-hint">
        <span>{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'} + Enter to save · Esc to cancel</span>
        <button className="btn primary small" onMouseDown={(e) => e.preventDefault()} onClick={() => finish(value)}>
          Save note
        </button>
      </div>
    </div>
  );
}
