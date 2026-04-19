import { getCurrentWindow } from "@tauri-apps/api/window";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_TAGS, Note, extractTags, formatDate,
  getTagStyle, groupNotesByDay,
} from "../lib/notes";
import { useNotesStore } from "../store/notesStore";

const appWindow = getCurrentWindow();

// ── Debounce hook ─────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

// ── Delete confirmation ───────────────────────────────────────────────────────
function DeleteConfirm({ onConfirm, onCancel }: {
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="delete-confirm">
      <span>Delete?</span>
      <button className="btn-confirm-yes" onClick={onConfirm}>Yes</button>
      <button className="btn-confirm-no"  onClick={onCancel}>No</button>
    </div>
  );
}

// ── Tag Popover ───────────────────────────────────────────────────────────────
function TagPopover({ note, onClose, onTagChange }: {
  note: Note;
  onClose: () => void;
  onTagChange: (id: number, newTags: string[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Use capture phase so the event fires before anything else
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler, true);
    return () => document.removeEventListener("mousedown", handler, true);
  }, [onClose]);

  const toggleTag = (tag: string) => {
    const newTags = note.tags.includes(tag)
      ? note.tags.filter((t) => t !== tag)
      : [...note.tags, tag];
    onTagChange(note.id, newTags);
    onClose();
  };

  return (
    <div ref={ref} className="tag-popover">
      <div className="tag-popover-title">Change tag</div>
      {ALL_TAGS.map((tag) => {
        const s = getTagStyle(tag);
        const active = note.tags.includes(tag);
        return (
          <div
            key={tag}
            className={`tag-popover-item${active ? " active" : ""}`}
            onClick={() => toggleTag(tag)}
            style={active ? { background: s.bg, color: s.text } : {}}
          >
            <span className="tag-popover-dot" style={{ background: s.text, opacity: 0.7 }} />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 12 }}>{tag}</span>
            {active && <span style={{ marginLeft: "auto", fontSize: 10, opacity: 0.6 }}>✓</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Note Card ─────────────────────────────────────────────────────────────────
// memo() so only the changed card re-renders, not the entire list
const NoteCard = memo(function NoteCard({ note, index, onDelete, onEdit, onPin, onCheck, onTagChange, onDragStart, onDragOver, onDrop }: {
  note: Note;
  index: number;
  onDelete: (id: number) => void;
  onEdit: (note: Note) => void;
  onPin: (id: number, pinned: boolean) => void;
  onCheck: (id: number, checked: boolean) => void;
  onTagChange: (id: number, tags: string[]) => void;
  onDragStart: (id: number) => void;
  onDragOver: (e: React.DragEvent, id: number) => void;
  onDrop: (id: number) => void;
}) {
  const [tagPopover, setTagPopover]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isTodo = note.tags.includes("#todo");

  return (
    <div
      className={`note-card${note.pinned ? " pinned" : ""}${note.checked ? " checked" : ""}`}
      style={{ animationDelay: `${index * 20}ms` }}
      draggable
      onDragStart={() => onDragStart(note.id)}
      onDragOver={(e) => { e.preventDefault(); onDragOver(e, note.id); }}
      onDrop={() => onDrop(note.id)}
    >
      <div className="drag-handle" title="Drag to reorder">⠿</div>

      {isTodo && (
        <div
          className="note-checkbox"
          onClick={(e) => { e.stopPropagation(); onCheck(note.id, !note.checked); }}
        >
          <div className={`checkbox${note.checked ? " checked" : ""}`}>
            {note.checked && <span className="checkbox-tick">✓</span>}
          </div>
        </div>
      )}

      <div className="note-body">
        <div className={`note-content${note.checked ? " note-content-checked" : ""}`}>
          {note.content}
        </div>
        <div className="note-meta">
          <span className="note-time">{formatDate(note.created_at)}</span>
          {note.tags.map((tag) => {
            const s = getTagStyle(tag);
            return (
              <span
                key={tag}
                className="tag-pill tag-pill-clickable"
                style={{ background: s.bg, color: s.text, borderColor: s.border }}
                onClick={(e) => { e.stopPropagation(); setTagPopover(true); }}
                title="Click to change tag"
              >
                {tag}
              </span>
            );
          })}
        </div>
      </div>

      {tagPopover && (
        <TagPopover
          note={note}
          onClose={() => setTagPopover(false)}
          onTagChange={onTagChange}
        />
      )}

      <div className="note-actions">
        <button
          className={`note-action-btn pin${note.pinned ? " pinned" : ""}`}
          title={note.pinned ? "Unpin" : "Pin"}
          onClick={(e) => { e.stopPropagation(); onPin(note.id, !note.pinned); }}
        >
          {note.pinned ? "★" : "☆"}
        </button>
        <button
          className="note-action-btn"
          title="Edit"
          onClick={(e) => { e.stopPropagation(); onEdit(note); }}
        >
          ✎
        </button>

        {confirmDelete ? (
          <DeleteConfirm
            onConfirm={() => { setConfirmDelete(false); onDelete(note.id); }}
            onCancel={() => setConfirmDelete(false)}
          />
        ) : (
          <button
            className="note-action-btn delete"
            title="Delete"
            onClick={(e) => { e.stopPropagation(); setConfirmDelete(true); }}
          >
            ✕
          </button>
        )}
      </div>
    </div>
  );
});

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({ note, onClose, onSave }: {
  note: Note;
  onClose: () => void;
  onSave: (id: number, content: string, tags: string[]) => void;
}) {
  const [value, setValue] = useState(note.content);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(value.length, value.length);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(() => {
    if (value.trim()) {
      onSave(note.id, value.trim(), extractTags(value));
      onClose();
    }
  }, [value, note.id, onSave, onClose]);

  return (
    <div
      className="edit-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="edit-modal">
        <textarea
          ref={ref}
          className="edit-textarea"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.ctrlKey) save();
            if (e.key === "Escape") onClose();
          }}
        />
        <div className="edit-actions">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>
            Save <kbd style={{ fontSize: 10, opacity: 0.6 }}>Ctrl+↵</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Library ──────────────────────────────────────────────────────────────
export default function Library() {
  const {
    notes, allTags, loading, activeTag, searchQuery,
    loadNotes, loadTags, deleteNote, updateNote,
    pinNote, toggleChecked, reorderNotes,
    setActiveTag, setSearchQuery,
  } = useNotesStore();

  const [editingNote, setEditingNote]   = useState<Note | null>(null);
  const [dragOverId, setDragOverId]     = useState<number | null>(null);
  const [localSearch, setLocalSearch]   = useState(searchQuery);
  const searchRef  = useRef<HTMLInputElement>(null);
  const dragId     = useRef<number | null>(null);

  // Debounce search so we don't invoke on every keystroke
  const debouncedSearch = useDebounce(localSearch, 220);
  useEffect(() => {
    setSearchQuery(debouncedSearch);
  }, [debouncedSearch, setSearchQuery]);

  // Initial load + refresh on window focus
  useEffect(() => {
    let cancelled = false;

    loadNotes();
    loadTags();
    requestAnimationFrame(() => {
      if (!cancelled) searchRef.current?.focus();
    });

    const unlistenPromise = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) { loadNotes(); loadTags(); }
    });
    return () => {
      cancelled = true;
      unlistenPromise.then((fn) => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Groups + flat index map — recomputed only when notes change
  const { groups, indexMap } = useMemo(() => {
    const groups = groupNotesByDay(notes);
    const indexMap = new Map<number, number>();
    let i = 0;
    groups.forEach(({ notes: g }) => g.forEach((n) => indexMap.set(n.id, i++)));
    return { groups, indexMap };
  }, [notes]);

  // ── Callbacks (stable references so memo'd NoteCards don't re-render) ──────
  const handleDelete = useCallback(async (id: number) => {
    await deleteNote(id);
  }, [deleteNote]);

  const handleTagChange = useCallback(async (id: number, newTags: string[]) => {
    const note = notes.find((n) => n.id === id);
    if (note) await updateNote(id, note.content, newTags);
  }, [notes, updateNote]);

  const handleDragStart = useCallback((id: number) => {
    dragId.current = id;
  }, []);

  const handleDragOver = useCallback((_e: React.DragEvent, id: number) => {
    setDragOverId(id);
  }, []);

  const handleDrop = useCallback(async (targetId: number) => {
    if (dragId.current === null || dragId.current === targetId) {
      setDragOverId(null);
      return;
    }
    const ids = notes.map((n) => n.id);
    const from = ids.indexOf(dragId.current);
    const to   = ids.indexOf(targetId);
    const newIds = [...ids];
    newIds.splice(from, 1);
    newIds.splice(to, 0, dragId.current!);
    dragId.current = null;
    setDragOverId(null);
    await reorderNotes(newIds);
  }, [notes, reorderNotes]);

  const handleSave = useCallback(async (id: number, content: string, tags: string[]) => {
    await updateNote(id, content, tags);
  }, [updateNote]);

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="library-root">
      <div className="titlebar">
        <div className="titlebar-title">
          <span style={{ color: "var(--accent)", fontSize: 8 }}>●</span>
          <span>spark</span>
          {activeTag && (
            <span style={{ color: "var(--text-3)", fontWeight: 400, fontFamily: "var(--font-mono)", fontSize: 12 }}>
              / {activeTag}
            </span>
          )}
          <span className="titlebar-count">{notes.length}</span>
        </div>
        <div className="titlebar-controls">
          <button className="titlebar-btn" onClick={() => appWindow.minimize()}>−</button>
          <button className="titlebar-btn danger" onClick={() => appWindow.hide()}>✕</button>
        </div>
      </div>

      <div className="library-body">
        {/* Sidebar */}
        <div className="sidebar">
          <div
            className={`sidebar-item${activeTag === null ? " active" : ""}`}
            onClick={() => setActiveTag(null)}
          >
            <div className="sidebar-item-left">
              <span style={{ fontSize: 13 }}>✦</span>
              <span style={{ fontSize: 13 }}>All Notes</span>
            </div>
            <span className="sidebar-item-count">{notes.length}</span>
          </div>

          {allTags.length > 0 && (
            <>
              <div className="sidebar-section-sep" />
              <div className="sidebar-label">Tags</div>
              {allTags.map((tag) => {
                const s = getTagStyle(tag);
                return (
                  <div
                    key={tag}
                    className={`sidebar-item${activeTag === tag ? " active" : ""}`}
                    onClick={() => setActiveTag(tag)}
                    style={activeTag === tag ? { background: s.bg, color: s.text } : {}}
                  >
                    <div className="sidebar-item-left">
                      <span className="sidebar-tag-dot"
                        style={{ background: s.text, borderColor: s.border, opacity: 0.8 }} />
                      <span className="sidebar-item-name">{tag}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Main content */}
        <div className="main-content">
          <div className="search-bar">
            <div className="search-input-wrap">
              <span className="search-icon">⌕</span>
              <input
                ref={searchRef}
                className="search-input"
                type="text"
                placeholder="Search notes..."
                value={localSearch}
                onChange={(e) => setLocalSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="notes-list">
            {loading && (
              <div className="empty-state">
                <div className="empty-state-icon">✦</div>
              </div>
            )}

            {!loading && notes.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">✦</div>
                <div className="empty-state-text">
                  {searchQuery ? "Nothing found" : "No notes yet"}
                </div>
                {!searchQuery && (
                  <div className="empty-state-hint">
                    Press <kbd>Ctrl+Shift+Space</kbd> to capture<br />your first thought
                  </div>
                )}
              </div>
            )}

            {!loading && groups.map(({ label, notes: groupNotes }) => (
              <div key={label} className="day-group">
                <div className={`day-label${label === "Pinned" ? " day-label-pinned" : ""}`}>
                  {label === "Pinned" && <span style={{ marginRight: 4 }}>★</span>}
                  {label}
                </div>
                {groupNotes.map((note) => (
                  <div key={note.id} className={dragOverId === note.id ? "drag-over" : ""}>
                    <NoteCard
                      note={note}
                      index={indexMap.get(note.id) ?? 0}
                      onDelete={handleDelete}
                      onEdit={setEditingNote}
                      onPin={pinNote}
                      onCheck={toggleChecked}
                      onTagChange={handleTagChange}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {editingNote && (
        <EditModal
          note={editingNote}
          onClose={() => setEditingNote(null)}
          onSave={handleSave}
        />
      )}
    </div>
  );
}