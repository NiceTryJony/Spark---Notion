import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ALL_TAGS, Note, extractTags, formatDate,
  getTagStyle, groupNotesByDay, getNoteOpacity,
  renderMarkdown, stripExplicitTags,
} from "../lib/notes";
import { useNotesStore } from "../store/notesStore";

const appWindow = getCurrentWindow();

// ── Todo-line detector (mirrors db.rs::is_todo_line) ─────────────────────────
function hasTodoMarker(line: string): boolean {
  const low = line.toLowerCase();
  return [
    "#todo","todo","to-do","to do","task","remind","reminder",
    "need to","must","should","plan","checklist","don't forget","dont forget",
    "сделать","нужно","надо","задача","план","напомнить","напомни",
    "не забыть","выполнить","проверить","список дел","запланировать","успеть",
    "zrobić","trzeba","należy","zadanie","przypomnienie",
    "nie zapomnieć","lista zadań","zaplanować",
    "зробити","треба","потрібно","завдання","нагадати","не забути",
    "запланувати","виконати",
  ].some(kw => low.includes(kw));
}

// ── Debounce hook ─────────────────────────────────────────────────────────────
function useDebounce<T>(value: T, ms: number): T {
  const [deb, setDeb] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDeb(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return deb;
}

// ── Delete confirmation ───────────────────────────────────────────────────────
function DeleteConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
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
  note: Note; onClose: () => void; onTagChange: (id: number, t: string[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h, true);
    return () => document.removeEventListener("mousedown", h, true);
  }, [onClose]);

  return (
    <div ref={ref} className="tag-popover">
      <div className="tag-popover-title">Change tag</div>
      {ALL_TAGS.map(tag => {
        const s = getTagStyle(tag);
        const active = note.tags.includes(tag);
        return (
          <div key={tag}
            className={`tag-popover-item${active ? " active" : ""}`}
            onClick={() => {
              const newTags = active ? note.tags.filter(t => t !== tag) : [...note.tags, tag];
              onTagChange(note.id, newTags); onClose();
            }}
            style={active ? { background: s.bg, color: s.text } : {}}
          >
            <span className="tag-popover-dot" style={{ background: s.text, opacity: 0.7 }} />
            <span style={{ fontFamily:"var(--font-mono)", fontSize:12 }}>{tag}</span>
            {active && <span style={{ marginLeft:"auto", fontSize:10, opacity:0.6 }}>✓</span>}
          </div>
        );
      })}
    </div>
  );
}

// ── Note Card ─────────────────────────────────────────────────────────────────
const NoteCard = memo(function NoteCard({ note, index, onDelete, onEdit, onView, onPin, onCheck, onTagChange }: {
  note: Note; index: number;
  onDelete: (id: number) => void;
  onEdit: (note: Note) => void;
  onView: (note: Note) => void;
  onPin: (id: number, pinned: boolean) => void;
  onCheck: (id: number, index: number, checked: boolean) => void;
  onTagChange: (id: number, tags: string[]) => void;
}) {
  const [tagPopover, setTagPopover]     = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isTodo = note.content.split("\n").some(hasTodoMarker);
  const opacity = getNoteOpacity(note.created_at, note.pinned);

  return (
    <div
      className={`note-card${note.pinned ? " pinned" : ""}`}
      style={{ animationDelay:`${index * 20}ms`, opacity }}
    >
      {isTodo && (
        <div className="note-checkboxes">
          {note.content.split("\n").map((line, lineIdx) => {
            if (!hasTodoMarker(line)) return null;
            const todoIndex = note.content.split("\n").slice(0, lineIdx).filter(hasTodoMarker).length;
            const isChecked = note.checked[todoIndex] ?? false;
            return (
              <div key={lineIdx} className="note-checkbox"
                onClick={e => { e.stopPropagation(); onCheck(note.id, todoIndex, !isChecked); }}
              >
                <div className={`checkbox${isChecked ? " checked" : ""}`}>
                  {isChecked && <span className="checkbox-tick">✓</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="note-body note-body-clickable" onClick={() => onView(note)}>
        <div className="note-content">
          {(() => {
            let todoIndex = 0;
            return note.content.split("\n").map((line, i) => {
              const isTodoLine = hasTodoMarker(line);
              const isChecked  = isTodoLine ? (note.checked[todoIndex] ?? false) : false;
              if (isTodoLine) todoIndex++;
              return (
                <div key={i} className={isChecked ? "note-content-checked" : ""}>
                  {stripExplicitTags(line) || "\u00A0"}
                </div>
              );
            });
          })()}
        </div>
        <div className="note-meta">
          <span className="note-time">{formatDate(note.created_at)}</span>
          {/* Show age indicator if fading */}
          {opacity < 0.9 && (
            <span className="note-age-hint" title="This note is getting old">
              {opacity < 0.5 ? "old" : opacity < 0.65 ? "2w" : "1w"}
            </span>
          )}
          {note.tags.map(tag => {
            const s = getTagStyle(tag);
            return (
              <span key={tag}
                className="tag-pill tag-pill-clickable"
                style={{ background:s.bg, color:s.text, borderColor:s.border }}
                onClick={e => { e.stopPropagation(); setTagPopover(true); }}
                title="Click to change tag"
              >{tag}</span>
            );
          })}
        </div>
      </div>

      {tagPopover && (
        <TagPopover note={note} onClose={() => setTagPopover(false)} onTagChange={onTagChange} />
      )}

      <div className="note-actions">
        <button
          className={`note-action-btn pin${note.pinned ? " pinned" : ""}`}
          title={note.pinned ? "Unpin" : "Pin"}
          onClick={e => { e.stopPropagation(); onPin(note.id, !note.pinned); }}
        >{note.pinned ? "★" : "☆"}</button>
        <button className="note-action-btn" title="Edit"
          onClick={e => { e.stopPropagation(); onEdit(note); }}>✎</button>
        {confirmDelete ? (
          <DeleteConfirm
            onConfirm={() => { setConfirmDelete(false); onDelete(note.id); }}
            onCancel={() => setConfirmDelete(false)}
          />
        ) : (
          <button className="note-action-btn delete" title="Delete"
            onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}>✕</button>
        )}
      </div>
    </div>
  );
});

// ── Formatting helper ─────────────────────────────────────────────────────────
function applyFormat(
  el: HTMLTextAreaElement,
  value: string,
  setValue: (s: string) => void,
  marker: string,
) {
  const s = el.selectionStart;
  const e = el.selectionEnd;
  const m = marker.length;
  const selected = value.slice(s, e);

  let next: string;
  let nextS: number, nextE: number;

  // Unwrap: markers sit just outside the selection
  if (value.slice(s - m, s) === marker && value.slice(e, e + m) === marker) {
    next  = value.slice(0, s - m) + selected + value.slice(e + m);
    nextS = s - m; nextE = e - m;
  // Unwrap: selection itself is wrapped
  } else if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= m * 2 + 1) {
    const inner = selected.slice(m, -m);
    next  = value.slice(0, s) + inner + value.slice(e);
    nextS = s; nextE = s + inner.length;
  // Wrap
  } else {
    next  = value.slice(0, s) + marker + selected + marker + value.slice(e);
    nextS = s + m; nextE = e + m;
  }

  setValue(next);
  requestAnimationFrame(() => el.setSelectionRange(nextS, nextE));
}

// ── Edit Modal ────────────────────────────────────────────────────────────────
function EditModal({ note, onClose, onSave }: {
  note: Note; onClose: () => void;
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
    if (value.trim()) { onSave(note.id, value.trim(), extractTags(value)); onClose(); }
  }, [value, note.id, onSave, onClose]);

  const fmt = useCallback((marker: string) => {
    if (ref.current) applyFormat(ref.current, value, setValue, marker);
  }, [value]);

  // const toolbarBtnStyle: React.CSSProperties = {
  //   background: "none", border: "1px solid var(--border)",
  //   borderRadius: 4, cursor: "pointer", padding: "2px 8px",
  //   fontSize: 12, color: "var(--text-2)", lineHeight: 1.6,
  //   transition: "color 0.15s, border-color 0.15s",
  // };

  const [preview, setPreview] = useState(true);
  const previewHtml = useMemo(
    () => renderMarkdown(stripExplicitTags(value)),
    [value]
  );

  const sep: React.CSSProperties = { width:1, height:16, background:"var(--border)", margin:"0 4px" };
  const tbBtn = (extra?: React.CSSProperties): React.CSSProperties => ({
    background:"none", border:"1px solid var(--border)", borderRadius:4,
    cursor:"pointer", padding:"2px 8px", fontSize:12, color:"var(--text-2)",
    lineHeight:1.6, transition:"color 0.15s, border-color 0.15s", ...extra,
  });

  return (
    <div className="edit-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="edit-modal" style={{
        width: preview ? "min(860px, 92vw)" : undefined,
        maxWidth: preview ? "92vw" : undefined,
        transition: "width 0.2s",
      }}>
        {/* Toolbar */}
        <div style={{ display:"flex", alignItems:"center", gap:4, marginBottom:8,
          paddingBottom:8, borderBottom:"1px solid var(--border)", flexWrap:"wrap" }}>
          <button type="button" style={tbBtn({ fontWeight:700 })} title="Bold — Ctrl+B"
            onMouseDown={e => { e.preventDefault(); fmt("**"); }}>B</button>
          <button type="button" style={tbBtn({ fontStyle:"italic" })} title="Italic — Ctrl+I"
            onMouseDown={e => { e.preventDefault(); fmt("*"); }}>I</button>
          <button type="button" style={tbBtn({ fontFamily:"var(--font-mono)", fontSize:11 })} title="Code — Ctrl+`"
            onMouseDown={e => { e.preventDefault(); fmt("`"); }}>`x`</button>
          <button type="button" style={tbBtn({ textDecoration:"line-through" })} title="Strikethrough — Ctrl+Shift+S"
            onMouseDown={e => { e.preventDefault(); fmt("~~"); }}>S</button>
          <div style={sep} />
          <button type="button"
            style={tbBtn({ color: preview ? "var(--accent)" : "var(--text-2)",
              borderColor: preview ? "var(--accent)" : "var(--border)" })}
            title={preview ? "Hide preview" : "Show preview"}
            onMouseDown={e => { e.preventDefault(); setPreview(p => !p); }}>
            {preview ? "⊟ preview" : "⊞ preview"}
          </button>
          <span style={{ fontSize:11, color:"var(--text-3)", marginLeft:"auto" }}>
            Ctrl+↵ save · Esc close
          </span>
        </div>

        {/* Editor + Preview */}
        <div style={{ display:"flex", gap:12, minHeight:0 }}>
          <div style={{ flex:1, display:"flex", flexDirection:"column", minWidth:0 }}>
            <textarea ref={ref} className="edit-textarea" value={value}
              style={{ flex:1, resize:"none" }}
              onChange={e => setValue(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && e.ctrlKey)  { save(); return; }
                if (e.key === "Escape")               { onClose(); return; }
                if (e.ctrlKey || e.metaKey) {
                  if (e.key === "b") { e.preventDefault(); fmt("**"); }
                  if (e.key === "i") { e.preventDefault(); fmt("*");  }
                  if (e.key === "`") { e.preventDefault(); fmt("`");  }
                  if (e.key === "s" && e.shiftKey) { e.preventDefault(); fmt("~~"); }
                }
              }}
            />
          </div>

          {preview && (
            <div style={{
              flex:1, minWidth:0, overflowY:"auto",
              padding:"10px 14px",
              background:"var(--bg-2, rgba(255,255,255,0.03))",
              border:"1px solid var(--border)",
              borderRadius:6,
              fontSize:13, lineHeight:1.7,
              color:"var(--text-1)",
            }}>
              {value.trim()
                ? <div className="md-content" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                : <span style={{ color:"var(--text-3)", fontStyle:"italic" }}>Preview will appear here…</span>
              }
            </div>
          )}
        </div>

        <div className="edit-actions" style={{ marginTop:10 }}>
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}

// ── View Modal ────────────────────────────────────────────────────────────────
function ViewModal({ note, onClose, onEdit }: {
  note: Note; onClose: () => void; onEdit: (note: Note) => void;
}) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose]);

  const html = renderMarkdown(stripExplicitTags(note.content));

  return (
    <div className="view-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="view-modal">
        <div className="view-modal-header">
          <div className="view-modal-tags">
            {note.tags.length > 0
              ? note.tags.map(tag => {
                  const s = getTagStyle(tag);
                  return <span key={tag} className="tag-pill"
                    style={{ background:s.bg, color:s.text, borderColor:s.border }}>{tag}</span>;
                })
              : <span style={{ fontSize:12, color:"var(--text-3)" }}>No tags</span>
            }
          </div>
          <span className="view-modal-meta">{formatDate(note.created_at)}</span>
          <button className="note-action-btn" title="Edit"
            onClick={() => { onClose(); onEdit(note); }}>✎</button>
          <button className="view-modal-close" title="Close (Esc)" onClick={onClose}>✕</button>
        </div>
        <div className="view-modal-body">
          <div className="md-content" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      </div>
    </div>
  );
}

// ── Export Modal ──────────────────────────────────────────────────────────────
type ExportRange = "week" | "month" | "all";

function ExportModal({ onClose }: { onClose: () => void }) {
  const [range, setRange]     = useState<ExportRange>("week");
  const [loading, setLoading] = useState(false);
  const [result, setResult]   = useState<{ path: string; note_count: number } | null>(null);
  const [error, setError]     = useState("");

  const doExport = async () => {
    setLoading(true); setError("");
    try {
      const sinceMs =
        range === "week"  ? Date.now() - 7  * 86_400_000 :
        range === "month" ? Date.now() - 30 * 86_400_000 : 0;
      const res = await invoke<{ path: string; note_count: number }>("export_notes", { sinceMs });
      setResult(res);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="edit-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="edit-modal" style={{ maxWidth:380 }}>
        <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:13, fontWeight:600, color:"var(--text-1)", marginBottom:12 }}>
            Export notes
          </div>
          {(["week","month","all"] as ExportRange[]).map(r => (
            <label key={r} style={{ display:"flex", alignItems:"center", gap:8, marginBottom:8,
              fontSize:13, color: range===r ? "var(--text-1)" : "var(--text-2)", cursor:"pointer" }}>
              <input type="radio" name="range" value={r} checked={range===r}
                onChange={() => setRange(r)} style={{ accentColor:"var(--accent)" }} />
              {{ week:"Last 7 days", month:"Last 30 days", all:"All notes" }[r]}
            </label>
          ))}
        </div>

        {result && (
          <div className="export-result">
            <span style={{ color:"var(--success)", fontSize:13 }}>✓ Exported {result.note_count} notes</span>
            <span className="export-path" title={result.path}>{result.path}</span>
          </div>
        )}
        {error && <div style={{ color:"var(--danger)", fontSize:12, marginBottom:10 }}>{error}</div>}

        <div className="edit-actions">
          <button className="btn btn-secondary" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={doExport} disabled={loading}>
            {loading ? "Exporting…" : "Export .md"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Sync Modal (super alpha) ──────────────────────────────────────────────────
function SyncModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode]           = useState<"idle"|"host"|"guest">("idle");
  const [hostAddr, setHostAddr]   = useState("");
  const [guestInput, setGuestInput] = useState("");
  const [loading, setLoading]     = useState(false);
  const [status, setStatus]       = useState("");
  const [error, setError]         = useState("");

  const startHost = async () => {
    setLoading(true); setError("");
    try {
      const res = await invoke<{ address: string }>("start_sync_server");
      setHostAddr(res.address);
      setMode("host");
      setStatus("Waiting for connection…");
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  const stopHost = async () => {
    await invoke("stop_sync_server").catch(() => {});
    setMode("idle"); setHostAddr(""); setStatus("");
  };

  const doSync = async () => {
    if (!guestInput.trim()) return;
    setLoading(true); setError(""); setStatus("");
    try {
      const count = await invoke<number>("sync_from_host", { hostAddr: guestInput.trim() });
      setStatus(`✓ Synced ${count} notes`);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  return (
    <div className="edit-overlay" onClick={e => { if (e.target === e.currentTarget) { stopHost(); onClose(); } }}>
      <div className="edit-modal" style={{ maxWidth:420 }}>
        <div style={{ fontSize:13, fontWeight:600, color:"var(--text-1)", marginBottom:4 }}>
          Local Network Sync
        </div>
        <div style={{ fontSize:11, color:"var(--text-3)", marginBottom:16, lineHeight:1.6 }}>
          ⚠️ Super alpha — LAN only, no encryption.
          Works between computers on the same Wi-Fi.
        </div>

        {mode === "idle" && (
          <div style={{ display:"flex", gap:10, marginBottom:12 }}>
            <button className="btn btn-primary" style={{ flex:1 }} onClick={startHost} disabled={loading}>
              {loading ? "Starting…" : "🖥 Share my notes (Host)"}
            </button>
            <button className="btn btn-secondary" style={{ flex:1 }} onClick={() => setMode("guest")}>
              📡 Connect to host (Guest)
            </button>
          </div>
        )}

        {mode === "host" && (
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:12, color:"var(--text-2)", marginBottom:6 }}>
              Share this address with the guest:
            </div>
            <div className="sync-address-box">
              {hostAddr}
              <button className="btn btn-secondary" style={{ fontSize:11, padding:"2px 8px", marginLeft:"auto" }}
                onClick={() => navigator.clipboard?.writeText(hostAddr)}>Copy</button>
            </div>
            <div style={{ fontSize:11, color:"var(--text-3)", marginTop:6 }}>{status}</div>
            <button className="btn btn-secondary" style={{ marginTop:10, fontSize:12 }} onClick={stopHost}>
              Stop hosting
            </button>
          </div>
        )}

        {mode === "guest" && (
          <div style={{ marginBottom:12 }}>
            <div style={{ fontSize:12, color:"var(--text-2)", marginBottom:6 }}>
              Enter host address (e.g. 192.168.1.5:49318):
            </div>
            <input className="search-input" style={{ marginBottom:10 }}
              placeholder="192.168.x.x:PORT"
              value={guestInput}
              onChange={e => setGuestInput(e.target.value)}
              onKeyDown={e => { if (e.key==="Enter") doSync(); }}
            />
            <div style={{ fontSize:11, color:"var(--success)" }}>{status}</div>
          </div>
        )}

        {error && <div style={{ color:"var(--danger)", fontSize:12, marginBottom:10 }}>{error}</div>}

        <div className="edit-actions">
          <button className="btn btn-secondary" onClick={() => { stopHost(); onClose(); }}>Close</button>
          {mode === "guest" && (
            <button className="btn btn-primary" onClick={doSync} disabled={loading}>
              {loading ? "Syncing…" : "Sync"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Command Palette ───────────────────────────────────────────────────────────
function CommandPalette({ notes, onClose, onView, onEdit }: {
  notes: Note[];
  onClose: () => void;
  onView: (note: Note) => void;
  onEdit: (note: Note) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef  = useRef<HTMLDivElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const results = useMemo(() => {
    const q = query.toLowerCase().trim();
    if (!q) return notes.slice(0, 12);
    return notes
      .filter(n => n.content.toLowerCase().includes(q) ||
                   n.tags.some(t => t.toLowerCase().includes(q)))
      .slice(0, 12);
  }, [query, notes]);

  // Reset cursor when results change
  useEffect(() => { setCursor(0); }, [results]);

  // Scroll active item into view
  useEffect(() => {
    const item = listRef.current?.children[cursor] as HTMLElement | undefined;
    item?.scrollIntoView({ block:"nearest" });
  }, [cursor]);

  const commit = (note: Note, mode: "view" | "edit") => {
    onClose();
    mode === "edit" ? onEdit(note) : onView(note);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape")     { e.preventDefault(); onClose(); }
    if (e.key === "ArrowDown")  { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    if (e.key === "ArrowUp")    { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter") {
      e.preventDefault();
      if (results[cursor]) commit(results[cursor], e.shiftKey ? "edit" : "view");
    }
  };

  const snippet = (content: string, q: string) => {
    const clean = stripExplicitTags(content).replace(/\n/g, " ");
    if (!q) return clean.slice(0, 80);
    const idx = clean.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return clean.slice(0, 80);
    const start = Math.max(0, idx - 30);
    return (start > 0 ? "…" : "") + clean.slice(start, idx + 60) + (idx + 60 < clean.length ? "…" : "");
  };

  return (
    <div style={{
      position:"fixed", inset:0, zIndex:200,
      background:"rgba(0,0,0,0.55)", backdropFilter:"blur(4px)",
      display:"flex", alignItems:"flex-start", justifyContent:"center",
      paddingTop:"12vh",
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        width:"min(600px, 90vw)",
        background:"var(--bg-1)", border:"1px solid var(--border)",
        borderRadius:10, overflow:"hidden",
        boxShadow:"0 24px 64px rgba(0,0,0,0.5)",
      }}>
        {/* Search input */}
        <div style={{ display:"flex", alignItems:"center", gap:8,
          padding:"10px 14px", borderBottom:"1px solid var(--border)" }}>
          <span style={{ color:"var(--text-3)", fontSize:16 }}>⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search notes…"
            style={{
              flex:1, background:"none", border:"none", outline:"none",
              fontSize:14, color:"var(--text-1)", fontFamily:"inherit",
            }}
          />
          {query && (
            <button onClick={() => setQuery("")}
              style={{ background:"none", border:"none", cursor:"pointer",
                color:"var(--text-3)", fontSize:16, padding:0 }}>✕</button>
          )}
        </div>

        {/* Results */}
        <div ref={listRef} style={{ maxHeight:380, overflowY:"auto" }}>
          {results.length === 0 && (
            <div style={{ padding:"24px", textAlign:"center",
              color:"var(--text-3)", fontSize:13 }}>No notes found</div>
          )}
          {results.map((note, i) => (
            <div key={note.id}
              style={{
                padding:"9px 14px", cursor:"pointer",
                background: i === cursor ? "var(--bg-hover, rgba(255,255,255,0.06))" : "none",
                borderBottom:"1px solid var(--border)",
                transition:"background 0.1s",
              }}
              onMouseEnter={() => setCursor(i)}
              onClick={() => commit(note, "view")}
            >
              <div style={{ display:"flex", alignItems:"center", gap:6, marginBottom:3 }}>
                {note.pinned && <span style={{ fontSize:10 }}>★</span>}
                <span style={{ fontSize:13, color:"var(--text-1)", fontWeight:500 }}>
                  {snippet(note.content, query) || "(empty)"}
                </span>
              </div>
              <div style={{ display:"flex", gap:6, alignItems:"center" }}>
                <span style={{ fontSize:11, color:"var(--text-3)" }}>
                  {formatDate(note.created_at)}
                </span>
                {note.tags.map(tag => {
                  const s = getTagStyle(tag);
                  return <span key={tag} style={{
                    fontSize:10, padding:"1px 5px", borderRadius:4,
                    background:s.bg, color:s.text, border:`1px solid ${s.border}`,
                  }}>{tag}</span>;
                })}
                <span style={{ fontSize:10, color:"var(--text-3)", marginLeft:"auto" }}>
                  Enter to view · Shift+Enter to edit
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div style={{ padding:"7px 14px", borderTop:"1px solid var(--border)",
          fontSize:11, color:"var(--text-3)", display:"flex", gap:12 }}>
          <span>↑↓ navigate</span>
          <span>↵ open</span>
          <span>⇧↵ edit</span>
          <span>Esc close</span>
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
    pinNote, toggleChecked, setActiveTag, setSearchQuery,
  } = useNotesStore();

  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [viewingNote, setViewingNote] = useState<Note | null>(null);
  const [showExport, setShowExport]   = useState(false);
  const [showSync, setShowSync]       = useState(false);
  const [showPalette, setShowPalette] = useState(false);
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const searchRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useDebounce(localSearch, 220);
  useEffect(() => { setSearchQuery(debouncedSearch); }, [debouncedSearch, setSearchQuery]);

  useEffect(() => {
    let cancelled = false;
    loadNotes(); loadTags();
    requestAnimationFrame(() => { if (!cancelled) searchRef.current?.focus(); });
    const u = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) { loadNotes(); loadTags(); }
    });
    return () => { cancelled = true; u.then(fn => fn()); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+K → Command Palette (fired from lib.rs via global shortcut)
  useEffect(() => {
    import("@tauri-apps/api/event").then(({ listen }) => {
      const unlisten = listen("toggle-palette", () => {
        setShowPalette(p => !p);
      });
      return () => { unlisten.then(fn => fn()); };
    });
  }, []);

  useEffect(() => {
    import("@tauri-apps/api/event").then(({ listen }) => {
    const unsub = listen("notes-updated", () => loadNotes());
    return () => { unsub.then(fn => fn()); };
    });
  }, []);

  const { groups, indexMap } = useMemo(() => {
    const groups = groupNotesByDay(notes);
    const indexMap = new Map<number, number>();
    let i = 0;
    groups.forEach(({ notes: g }) => g.forEach(n => indexMap.set(n.id, i++)));
    return { groups, indexMap };
  }, [notes]);

  const handleDelete    = useCallback(async (id: number) => { await deleteNote(id); }, [deleteNote]);
  const handleTagChange = useCallback(async (id: number, newTags: string[]) => {
    const note = notes.find(n => n.id === id);
    if (note) await updateNote(id, note.content, newTags);
  }, [notes, updateNote]);
  const handleSave = useCallback(async (id: number, content: string, tags: string[]) => {
    await updateNote(id, content, tags);
  }, [updateNote]);
  const handleView = useCallback((note: Note) => setViewingNote(note), []);

  return (
    <div className="library-root">
      <div className="titlebar">
        <div className="titlebar-title">
          <span style={{ color:"var(--accent)", fontSize:8 }}>●</span>
          <span>spark</span>
          {activeTag && (
            <span style={{ color:"var(--text-3)", fontWeight:400, fontFamily:"var(--font-mono)", fontSize:12 }}>
              / {activeTag}
            </span>
          )}
          <span className="titlebar-count">{notes.length}</span>
        </div>
        <div className="titlebar-controls">
          {/* Export button */}
          <button className="titlebar-btn" title="Export notes" onClick={() => setShowExport(true)}>⬇</button>
          {/* Sync button */}
          <button className="titlebar-btn" title="Local sync (alpha)" onClick={() => setShowSync(true)}>⇄</button>
          <button className="titlebar-btn" onClick={() => appWindow.minimize()}>−</button>
          <button className="titlebar-btn danger" onClick={() => appWindow.hide()}>✕</button>
        </div>
      </div>

      <div className="library-body">
        <div className="sidebar">
          <div className={`sidebar-item${activeTag === null ? " active" : ""}`}
            onClick={() => setActiveTag(null)}>
            <div className="sidebar-item-left">
              <span style={{ fontSize:13 }}>✦</span>
              <span style={{ fontSize:13 }}>All Notes</span>
            </div>
            <span className="sidebar-item-count">{notes.length}</span>
          </div>
          {allTags.length > 0 && (
            <>
              <div className="sidebar-section-sep" />
              <div className="sidebar-label">Tags</div>
              {allTags.map(tag => {
                const s = getTagStyle(tag);
                return (
                  <div key={tag}
                    className={`sidebar-item${activeTag===tag ? " active" : ""}`}
                    onClick={() => setActiveTag(tag)}
                    style={activeTag===tag ? { background:s.bg, color:s.text } : {}}
                  >
                    <div className="sidebar-item-left">
                      <span className="sidebar-tag-dot"
                        style={{ background:s.text, borderColor:s.border, opacity:0.8 }} />
                      <span className="sidebar-item-name">{tag}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="main-content">
          <div className="search-bar">
            <div className="search-input-wrap">
              <span className="search-icon">⌕</span>
              <input ref={searchRef} className="search-input" type="text"
                placeholder="Search notes..." value={localSearch}
                onChange={e => setLocalSearch(e.target.value)} />
            </div>
          </div>

          <div className="notes-list">
            {loading && <div className="empty-state"><div className="empty-state-icon">✦</div></div>}
            {!loading && notes.length === 0 && (
              <div className="empty-state">
                <div className="empty-state-icon">✦</div>
                <div className="empty-state-text">{searchQuery ? "Nothing found" : "No notes yet"}</div>
                {!searchQuery && (
                  <div className="empty-state-hint">
                    Press <kbd>Ctrl+Shift+Space</kbd> to capture<br />your first thought
                  </div>
                )}
              </div>
            )}
            {!loading && groups.map(({ label, notes: groupNotes }) => (
              <div key={label} className="day-group">
                <div className={`day-label${label==="Pinned" ? " day-label-pinned" : ""}`}>
                  {label==="Pinned" && <span style={{ marginRight:4 }}>★</span>}
                  {label}
                </div>
                {groupNotes.map(note => (
                  <NoteCard key={note.id} note={note}
                    index={indexMap.get(note.id) ?? 0}
                    onDelete={handleDelete} onEdit={setEditingNote}
                    onView={handleView} onPin={pinNote}
                    onCheck={toggleChecked} onTagChange={handleTagChange}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {editingNote && (
        <EditModal note={editingNote} onClose={() => setEditingNote(null)} onSave={handleSave} />
      )}
      {viewingNote && (
        <ViewModal note={viewingNote} onClose={() => setViewingNote(null)}
          onEdit={n => { setViewingNote(null); setEditingNote(n); }} />
      )}
      {showExport  && <ExportModal onClose={() => setShowExport(false)} />}
      {showSync    && <SyncModal   onClose={() => setShowSync(false)} />}
      {showPalette && (
        <CommandPalette
          notes={notes}
          onClose={() => setShowPalette(false)}
          onView={n  => { setShowPalette(false); setViewingNote(n); }}
          onEdit={n  => { setShowPalette(false); setEditingNote(n); }}
        />
      )}
    </div>
  );
}