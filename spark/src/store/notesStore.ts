import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { Note } from "../lib/notes";

interface NotesStore {
  notes: Note[];
  allTags: string[];
  loading: boolean;
  error: string | null;
  activeTag: string | null;
  searchQuery: string;
  loadNotes: () => Promise<void>;
  loadTags: () => Promise<void>;
  searchNotes: (query: string) => Promise<void>;
  saveNote: (content: string, tags: string[]) => Promise<Note>;
  deleteNote: (id: number) => Promise<void>;
  updateNote: (id: number, content: string, tags: string[]) => Promise<void>;
  pinNote: (id: number, pinned: boolean) => Promise<void>;
  toggleChecked: (id: number, checked: boolean) => Promise<void>;
  reorderNotes: (ids: number[]) => Promise<void>;
  setActiveTag: (tag: string | null) => void;
  setSearchQuery: (q: string) => void;
  clearError: () => void;
}

// ---------------------------------------------------------------------------
// Race condition guard
// Each call to loadNotes / searchNotes stamps a sequence number.
// If a newer call lands first the older response is silently dropped.
// ---------------------------------------------------------------------------
let _seq = 0;

// ---------------------------------------------------------------------------
// Tiny helper: sort notes so pinned ones always come first
// ---------------------------------------------------------------------------
function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.sort_order - b.sort_order;
  });
}

// ---------------------------------------------------------------------------
// Merge new tags into the existing sorted tag list (no duplicates)
// ---------------------------------------------------------------------------
function mergeTags(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])].sort();
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [],
  allTags: [],
  loading: false,
  error: null,
  activeTag: null,
  searchQuery: "",

  clearError: () => set({ error: null }),

  // ── loadNotes ─────────────────────────────────────────────────────────────
  loadNotes: async () => {
    const seq = ++_seq;
    set({ loading: true, error: null });
    try {
      const { activeTag } = get();
      const notes = await invoke<Note[]>("get_notes", { tag: activeTag });
      // Drop stale responses
      if (seq !== _seq) return;
      set({ notes: sortNotes(notes), loading: false });
    } catch (err) {
      if (seq !== _seq) return;
      console.error("loadNotes:", err);
      set({ loading: false, error: String(err) });
    }
  },

  // ── loadTags ──────────────────────────────────────────────────────────────
  loadTags: async () => {
    try {
      const allTags = await invoke<string[]>("get_all_tags");
      set({ allTags });
    } catch (err) {
      console.error("loadTags:", err);
      set({ error: String(err) });
    }
  },

  // ── searchNotes ───────────────────────────────────────────────────────────
  searchNotes: async (query: string) => {
    const seq = ++_seq;
    set({ loading: true, searchQuery: query, error: null });
    try {
      const notes = await invoke<Note[]>("search_notes", { query });
      if (seq !== _seq) return;
      set({ notes, loading: false });
    } catch (err) {
      if (seq !== _seq) return;
      console.error("searchNotes:", err);
      set({ loading: false, error: String(err) });
    }
  },

  // ── saveNote ──────────────────────────────────────────────────────────────
  saveNote: async (content, tags) => {
    try {
      const note = await invoke<Note>("save_note", { content, tags });
      set((state) => ({
        notes: sortNotes([note, ...state.notes]),
        allTags: mergeTags(state.allTags, tags),
      }));
      return note;
    } catch (err) {
      console.error("saveNote:", err);
      set({ error: String(err) });
      throw err; // re-throw so the caller can react (e.g. keep the editor open)
    }
  },

  // ── deleteNote ────────────────────────────────────────────────────────────
  deleteNote: async (id) => {
    try {
      await invoke("delete_note", { id });
      set((state) => ({ notes: state.notes.filter((n) => n.id !== id) }));
      // Refresh tag list — a tag might now be unused
      get().loadTags();
    } catch (err) {
      console.error("deleteNote:", err);
      set({ error: String(err) });
      throw err;
    }
  },

  // ── updateNote ────────────────────────────────────────────────────────────
  updateNote: async (id, content, tags) => {
    try {
      const updated = await invoke<Note>("update_note", { id, content, tags });
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? updated : n)),
        // Merge any newly introduced tags into the sidebar list
        allTags: mergeTags(state.allTags, tags),
      }));
    } catch (err) {
      console.error("updateNote:", err);
      set({ error: String(err) });
      throw err;
    }
  },

  // ── pinNote ───────────────────────────────────────────────────────────────
  // Previously called loadNotes() after update, causing a redundant round-trip.
  // Now we just re-sort in memory — pinned notes float to the top immediately.
  pinNote: async (id, pinned) => {
    try {
      const updated = await invoke<Note>("pin_note", { id, pinned });
      set((state) => ({
        notes: sortNotes(state.notes.map((n) => (n.id === id ? updated : n))),
      }));
    } catch (err) {
      console.error("pinNote:", err);
      set({ error: String(err) });
      throw err;
    }
  },

  // ── toggleChecked ─────────────────────────────────────────────────────────
  toggleChecked: async (id, checked) => {
    try {
      const updated = await invoke<Note>("toggle_checked", { id, checked });
      set((state) => ({
        notes: state.notes.map((n) => (n.id === id ? updated : n)),
      }));
    } catch (err) {
      console.error("toggleChecked:", err);
      set({ error: String(err) });
      throw err;
    }
  },

  // ── reorderNotes ──────────────────────────────────────────────────────────
  reorderNotes: async (ids) => {
    // Snapshot current order for rollback
    const previous = get().notes;

    // Optimistic update
    set((state) => {
      const noteMap = new Map(state.notes.map((n) => [n.id, n]));
      const reordered = ids
        .map((id) => noteMap.get(id))
        .filter(Boolean) as Note[];
      const rest = state.notes.filter((n) => !ids.includes(n.id));
      return { notes: [...reordered, ...rest] };
    });

    try {
      await invoke("reorder_notes", { ids });
    } catch (err) {
      console.error("reorderNotes:", err);
      // Roll back to the order before the drag
      set({ notes: previous, error: String(err) });
    }
  },

  // ── setActiveTag ──────────────────────────────────────────────────────────
  setActiveTag: (tag) => {
    set({ activeTag: tag, searchQuery: "" });
    get().loadNotes();
  },

  // ── setSearchQuery ────────────────────────────────────────────────────────
  setSearchQuery: (q) => {
    set({ searchQuery: q });
    if (q.trim()) get().searchNotes(q);
    else get().loadNotes();
  },
}));