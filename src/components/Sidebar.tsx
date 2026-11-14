import { useState, type DragEvent, type ReactNode } from 'react';
import { CATEGORY_COLORS, type Category, type CategoryColor, type View } from '../types';
import { Icon, type IconName } from './Icon';

type Props = {
  view: View;
  onView: (v: View) => void;
  categories: Category[];
  counts: Record<string, number>;
  onAddCategory: (name: string, emoji: string, color: CategoryColor) => void;
  onUpdateCategory: (id: string, patch: Partial<Category>) => void;
  onDeleteCategory: (id: string) => void;
  onDropClip: (clipId: string, categoryId: string | null) => void;
  privateSupported: boolean;
  privateUnlocked: boolean;
  privateCount: number;
  onOpenPrivate: () => void;
  onLockPrivate: () => void;
  syncLabel: string | null;
  syncing: boolean;
  onOpenSettings: () => void;
};

const EMOJIS = ['📁', '💼', '📚', '💻', '✨', '🎨', '🛒', '✈️', '🍳', '🎵', '🎬', '🔗', '📝', '💡', '🏠', '❤️'];

const sameView = (a: View, b: View) => a.kind === b.kind && (a.kind !== 'category' || (b.kind === 'category' && a.id === b.id));

export function Sidebar(props: Props) {
  const { view, onView, categories, counts } = props;
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const smart: { view: View; icon: IconName; label: string; count: number }[] = [
    { view: { kind: 'all' }, icon: 'grid', label: 'All Clips', count: counts.all },
    { view: { kind: 'favorites' }, icon: 'star', label: 'Favorites', count: counts.favorites },
    { view: { kind: 'links' }, icon: 'link', label: 'Links', count: counts.links },
    { view: { kind: 'snippets' }, icon: 'text', label: 'Snippets', count: counts.snippets },
    { view: { kind: 'images' }, icon: 'image', label: 'Images', count: counts.images },
    { view: { kind: 'notes' }, icon: 'note', label: 'With Notes', count: counts.notes },
  ];

  return (
    <aside className="sidebar glass">
      <div className="brand drag">
        <div className="brand-mark">
          <Icon name="clipboard" size={18} />
        </div>
        <div>
          <div className="brand-name">ClipVault</div>
          <div className="brand-sub">your favorite copies</div>
        </div>
      </div>

      <nav className="nav">
        <div className="nav-label">Library</div>
        {smart.map((s) => (
          <NavItem key={s.label} active={sameView(view, s.view)} onClick={() => onView(s.view)} count={s.count}>
            <Icon name={s.icon} size={16} filled={s.icon === 'star' && sameView(view, s.view)} />
            <span>{s.label}</span>
          </NavItem>
        ))}
        <NavItem
          active={view.kind === 'uncategorized'}
          onClick={() => onView({ kind: 'uncategorized' })}
          count={counts.uncategorized}
          onDropClip={(id) => props.onDropClip(id, null)}
        >
          <Icon name="inbox" size={16} />
          <span>Unsorted</span>
        </NavItem>
        {props.privateUnlocked && (
          <NavItem
            active={view.kind === 'private'}
            onClick={props.onOpenPrivate}
            count={props.privateCount}
            title="Private · encrypted"
            actions={
              <button className="icon-btn tiny" title="Lock now" onClick={props.onLockPrivate}>
                <Icon name="lock" size={13} />
              </button>
            }
          >
            <Icon name="unlock" size={16} />
            <span>Private</span>
          </NavItem>
        )}

        <div className="nav-label nav-label-row">
          <span>Categories</span>
          <button className="icon-btn tiny" title="New category" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} />
          </button>
        </div>

        {categories.map((c) =>
          editingId === c.id ? (
            <CategoryForm
              key={c.id}
              initial={c}
              onCancel={() => setEditingId(null)}
              onSubmit={(name, emoji, color) => {
                props.onUpdateCategory(c.id, { name, emoji, color });
                setEditingId(null);
              }}
              onDelete={() => {
                props.onDeleteCategory(c.id);
                setEditingId(null);
              }}
            />
          ) : (
            <NavItem
              key={c.id}
              active={view.kind === 'category' && view.id === c.id}
              onClick={() => onView({ kind: 'category', id: c.id })}
              onDoubleClick={() => setEditingId(c.id)}
              count={counts[c.id] ?? 0}
              onDropClip={(id) => props.onDropClip(id, c.id)}
              title="Double-click to edit · drop clips here"
              actions={
                <>
                  <button className="icon-btn tiny" title="Edit category" onClick={() => setEditingId(c.id)}>
                    <Icon name="edit" size={13} />
                  </button>
                  <button className="icon-btn tiny danger" title="Delete category" onClick={() => props.onDeleteCategory(c.id)}>
                    <Icon name="trash" size={13} />
                  </button>
                </>
              }
            >
              <span className={`cat-dot c-${c.color}`}>{c.emoji}</span>
              <span className="truncate">{c.name}</span>
            </NavItem>
          ),
        )}

        {adding && (
          <CategoryForm
            onCancel={() => setAdding(false)}
            onSubmit={(name, emoji, color) => {
              props.onAddCategory(name, emoji, color);
              setAdding(false);
            }}
          />
        )}
        {!adding && categories.length === 0 && (
          <button className="ghost-add" onClick={() => setAdding(true)}>
            <Icon name="plus" size={14} /> Create your first category
          </button>
        )}
      </nav>

      <div className="sidebar-foot">
        {props.syncLabel ? (
          <button className={`sync-chip${props.syncing ? ' on' : ''}`} onClick={props.onOpenSettings} title="Cloud sync settings">
            <Icon name={props.syncing ? 'cloud' : 'settings'} size={14} />
            <span className="truncate">{props.syncing ? `Synced · ${props.syncLabel}` : 'Set up cloud sync'}</span>
          </button>
        ) : (
          <>
            <Icon name="sun" size={14} />
            <span>Drag clips onto a category</span>
          </>
        )}
        {props.privateSupported && (
          <button
            className={`icon-btn tiny vault-btn${props.privateUnlocked ? ' open' : ''}`}
            title={props.privateUnlocked ? 'Lock' : undefined}
            aria-label={props.privateUnlocked ? 'Lock private section' : 'Private section'}
            onClick={props.privateUnlocked ? props.onLockPrivate : props.onOpenPrivate}
          >
            <Icon name={props.privateUnlocked ? 'unlock' : 'lock'} size={13} />
          </button>
        )}
      </div>
    </aside>
  );
}

function NavItem({
  active,
  onClick,
  onDoubleClick,
  count,
  children,
  onDropClip,
  title,
  actions,
}: {
  active: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  count: number;
  children: ReactNode;
  onDropClip?: (clipId: string) => void;
  title?: string;
  actions?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const dropProps = onDropClip
    ? {
        onDragOver: (e: DragEvent) => {
          if (e.dataTransfer.types.includes('application/x-clip-id')) {
            e.preventDefault();
            setOver(true);
          }
        },
        onDragLeave: () => setOver(false),
        onDrop: (e: DragEvent) => {
          setOver(false);
          const id = e.dataTransfer.getData('application/x-clip-id');
          if (id) onDropClip(id);
        },
      }
    : {};
  // A div (not a button) so hover action buttons can be nested inside.
  return (
    <div
      role="button"
      tabIndex={0}
      className={`nav-item${active ? ' active' : ''}${over ? ' drop-over' : ''}${actions ? ' has-actions' : ''}`}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      title={title}
      {...dropProps}
    >
      {children}
      <span className="nav-count">{count}</span>
      {actions && (
        <span className="nav-actions" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          {actions}
        </span>
      )}
    </div>
  );
}

function CategoryForm({
  initial,
  onSubmit,
  onCancel,
  onDelete,
}: {
  initial?: Category;
  onSubmit: (name: string, emoji: string, color: CategoryColor) => void;
  onCancel: () => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '📁');
  const [color, setColor] = useState<CategoryColor>(initial?.color ?? 'sky');

  return (
    <form
      className="cat-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) onSubmit(name.trim(), emoji, color);
      }}
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <input autoFocus className="field" placeholder="Category name" value={name} onChange={(e) => setName(e.target.value)} />
      <div className="emoji-row">
        {EMOJIS.map((em) => (
          <button type="button" key={em} className={`emoji-opt${em === emoji ? ' on' : ''}`} onClick={() => setEmoji(em)}>
            {em}
          </button>
        ))}
      </div>
      <div className="color-row">
        {CATEGORY_COLORS.map((c) => (
          <button
            type="button"
            key={c}
            aria-label={c}
            className={`swatch c-${c}${c === color ? ' on' : ''}`}
            onClick={() => setColor(c)}
          />
        ))}
      </div>
      <div className="cat-form-actions">
        {onDelete && (
          <button
            type="button"
            className="btn danger small"
            onClick={onDelete}
          >
            Delete
          </button>
        )}
        <span className="spacer" />
        <button type="button" className="btn small" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary small" disabled={!name.trim()}>
          {initial ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  );
}
