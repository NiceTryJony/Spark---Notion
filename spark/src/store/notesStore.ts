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
  toggleChecked: (id: number, index: number, checked: boolean) => Promise<void>;
  setActiveTag: (tag: string | null) => void;
  setSearchQuery: (q: string) => void;
  clearError: () => void;
}

let _seq = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

function sortNotes(notes: Note[]): Note[] {
  return [...notes].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.sort_order - a.sort_order;
  });
}

function mergeTags(existing: string[], incoming: string[]): string[] {
  return [...new Set([...existing, ...incoming])].sort();
}

export const useNotesStore = create<NotesStore>((set, get) => ({
  notes: [], allTags: [], loading: false, error: null, activeTag: null, searchQuery: "",

  clearError: () => set({ error: null }),

  loadNotes: async () => {
    const seq = ++_seq;
    set({ loading: true, error: null });
    try {
      const { activeTag } = get();
      const notes = await invoke<Note[]>("get_notes", { tag: activeTag });
      if (seq !== _seq) return;
      set({ notes: sortNotes(notes), loading: false });
    } catch (err) {
      if (seq !== _seq) return;
      set({ loading: false, error: String(err) });
    }
  },

  loadTags: async () => {
    try {
      const allTags = await invoke<string[]>("get_all_tags");
      set({ allTags });
    } catch (err) { set({ error: String(err) }); }
  },

  searchNotes: async (query) => {
    const seq = ++_seq;
    set({ loading: true, searchQuery: query, error: null });
    try {
      const notes = await invoke<Note[]>("search_notes", { query });
      if (seq !== _seq) return;
      set({ notes, loading: false });
    } catch (err) {
      if (seq !== _seq) return;
      set({ loading: false, error: String(err) });
    }
  },

  saveNote: async (content, tags) => {
    try {
      const note = await invoke<Note>("save_note", { content, tags });
      set(state => ({
        notes: sortNotes([note, ...state.notes]),
        allTags: mergeTags(state.allTags, tags),
      }));
      return note;
    } catch (err) {
      set({ error: String(err) }); throw err;
    }
  },

  deleteNote: async (id) => {
    try {
      await invoke("delete_note", { id });
      set(state => ({ notes: state.notes.filter(n => n.id !== id) }));
      get().loadTags();
    } catch (err) { set({ error: String(err) }); throw err; }
  },

  updateNote: async (id, content, tags) => {
    try {
      const updated = await invoke<Note>("update_note", { id, content, tags });
      set(state => ({
        notes: state.notes.map(n => n.id === id ? updated : n),
        allTags: mergeTags(state.allTags, tags),
      }));
      get().loadTags(); // синхронизировать реальный список тегов
    } catch (err) { set({ error: String(err) }); throw err; }
  },

  pinNote: async (id, pinned) => {
    try {
      const updated = await invoke<Note>("pin_note", { id, pinned });
      set(state => ({
        notes: sortNotes(state.notes.map(n => n.id === id ? updated : n)),
      }));
    } catch (err) { set({ error: String(err) }); throw err; }
  },

  toggleChecked: async (id, index, checked) => {
    try {
      const updated = await invoke<Note>("toggle_checked", { id, index, checked });
      set(state => ({ notes: state.notes.map(n => n.id === id ? updated : n) }));
    } catch (err) { set({ error: String(err) }); throw err; }
  },

  
  setActiveTag: (tag) => { set({ activeTag: tag, searchQuery: "" }); get().loadNotes(); },
  setSearchQuery: (q) => {
    set({ searchQuery: q });
    // if (q.trim()) get().searchNotes(q); else get().loadNotes();
    if (searchTimer) clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
     if (q.trim()) get().searchNotes(q); else get().loadNotes();
   }, 150);
  },
}));