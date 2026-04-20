import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_TAGS, extractTags, getTagStyle } from "../lib/notes";
import { useNotesStore } from "../store/notesStore";

const appWindow = getCurrentWindow();

// ── Tag dropdown helpers ───────────────────────────────────────────────────────

/**
 * Finds an active `#partial` token at the cursor position.
 * Returns { query, start } or null if cursor is not inside a hashtag.
 *
 * Example:  "купить молоко #bu|"  →  { query: "bu", start: 15 }
 *           "купить #todo молоко|" →  null  (cursor after space, not inside tag)
 */
function getHashtagAtCursor(
  text: string,
  cursor: number
): { query: string; start: number } | null {
  // Walk left from cursor until we hit a space/newline or start of string
  let i = cursor - 1;
  while (i >= 0 && text[i] !== " " && text[i] !== "\n") i--;
  const tokenStart = i + 1;
  const token = text.slice(tokenStart, cursor);
  if (token.startsWith("#")) {
    return { query: token.slice(1).toLowerCase(), start: tokenStart };
  }
  return null;
}

/**
 * Inserts a full tag into `text` replacing the `#partial` token.
 * Returns the new text and the new cursor position (right after the inserted tag + space).
 */
function insertTag(
  text: string,
  cursor: number,
  tag: string,        // e.g. "#work"
  tokenStart: number
): { newText: string; newCursor: number } {
  const before = text.slice(0, tokenStart);
  const after  = text.slice(cursor);
  // Add a trailing space only if the next char isn't already a space
  const space  = after.startsWith(" ") || after === "" ? "" : " ";
  const newText   = before + tag + space + after;
  const newCursor = (before + tag + space).length;
  return { newText, newCursor };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Overlay() {
  const [value, setValue]     = useState("");
  const [saving, setSaving]   = useState(false);
  const [flash, setFlash]     = useState(false);

  // ── Tag dropdown state ────────────────────────────────────────────────────
  const [dropdown, setDropdown] = useState<{
    query: string;
    tokenStart: number;
    options: string[];
    activeIndex: number;
  } | null>(null);

  const textareaRef  = useRef<HTMLTextAreaElement>(null);
  const initialised  = useRef(false);

  const detectedTags = useMemo(() => extractTags(value), [value]);
  const hasText      = value.trim().length > 0;
  const saveNote     = useNotesStore((s) => s.saveNote);

  // ── Focus on show ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    const focusOnly = () => {
      requestAnimationFrame(() => { if (!cancelled) textareaRef.current?.focus(); });
    };
    if (!initialised.current) { initialised.current = true; setValue(""); setDropdown(null); }
    focusOnly();
    const unlistenPromise = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) focusOnly();
    });
    return () => { cancelled = true; unlistenPromise.then(fn => fn()); };
  }, []);

  // ── Auto-resize textarea ───────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // ── Close dropdown helper ──────────────────────────────────────────────────
  const closeDropdown = useCallback(() => setDropdown(null), []);

  // ── Apply selected tag from dropdown ─────────────────────────────────────
  const applyTag = useCallback((tag: string, tokenStart: number) => {
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart ?? value.length;
    const { newText, newCursor } = insertTag(value, cursor, tag, tokenStart);
    setValue(newText);
    setDropdown(null);
    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
    });
  }, [value]);

  // ── Input change → maybe open dropdown ────────────────────────────────────
  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    const cursor   = e.target.selectionStart ?? newValue.length;
    setValue(newValue);

    const hit = getHashtagAtCursor(newValue, cursor);
    if (hit) {
      const options = ALL_TAGS.filter(t =>
        t.slice(1).startsWith(hit.query)   // e.g. "#work" starts with "wo"
      );
      if (options.length > 0) {
        setDropdown({ query: hit.query, tokenStart: hit.start, options, activeIndex: 0 });
        return;
      }
    }
    setDropdown(null);
  }, []);

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!hasText || saving) return;
    setSaving(true); setFlash(true);
    try {
      await saveNote(value.trim(), detectedTags);
      setValue(""); setDropdown(null);
      initialised.current = false;
      setTimeout(() => appWindow.hide(), 180);
    } catch (err) {
      console.error("save error:", err);
      setFlash(false);
    } finally {
      setSaving(false);
      setTimeout(() => setFlash(false), 350); }
  }, [hasText, saving, value, detectedTags, saveNote]);

  // ── Keyboard ───────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ── When dropdown is open ──────────────────────────────────────────────
    if (dropdown) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setDropdown(d => d ? { ...d, activeIndex: (d.activeIndex + 1) % d.options.length } : null);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setDropdown(d => d ? { ...d, activeIndex: (d.activeIndex - 1 + d.options.length) % d.options.length } : null);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const selected = dropdown.options[dropdown.activeIndex];
        applyTag(selected, dropdown.tokenStart);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeDropdown();
        return;
      }
    }

    // ── Normal mode ────────────────────────────────────────────────────────
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); return; }
    if (e.key === "Escape") {
      initialised.current = false;
      appWindow.hide();
    }
  }, [dropdown, handleSave, applyTag, closeDropdown]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="overlay-root">
      <div className={`overlay-card${flash ? " flash" : ""}`}>

        <div className="overlay-header" data-tauri-drag-region>
          <div className="overlay-logo">
            <span className="dot" />
            <span>spark</span>
          </div>
          <button
            className="overlay-close"
            onClick={() => { initialised.current = false; setDropdown(null); appWindow.hide(); }}
            title="Esc"
          >✕</button>
        </div>

        {/* Input area — relative so dropdown can be positioned below */}
        <div className="overlay-input-wrap">
          <textarea
            ref={textareaRef}
            className="overlay-input"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="Write your thought..."
            rows={3}
            // Close dropdown when user clicks away inside the textarea
            onClick={() => {
              const el = textareaRef.current;
              if (!el || !dropdown) return;
              const hit = getHashtagAtCursor(value, el.selectionStart ?? value.length);
              if (!hit) closeDropdown();
            }}
          />

          {/* Tag dropdown */}
          {dropdown && (
            <div className="tag-dropdown">
              {dropdown.options.map((tag, i) => {
                const s = getTagStyle(tag);
                return (
                  <div
                    key={tag}
                    className={`tag-dropdown-item${i === dropdown.activeIndex ? " active" : ""}`}
                    style={i === dropdown.activeIndex ? { background: s.bg } : {}}
                    // mouseDown instead of click — fires before textarea blur
                    onMouseDown={e => { e.preventDefault(); applyTag(tag, dropdown.tokenStart); }}
                  >
                    <span
                      className="tag-dropdown-dot"
                      style={{ background: s.text }}
                    />
                    <span
                      className="tag-dropdown-label"
                      style={{ color: i === dropdown.activeIndex ? s.text : "var(--text-2)" }}
                    >
                      {tag}
                    </span>
                    {/* Highlight the matched prefix */}
                    {dropdown.query.length > 0 && (
                      <span className="tag-dropdown-match">
                        #{dropdown.query}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="overlay-footer">
          <div className="overlay-tags">
            {detectedTags.length > 0 ? (
              detectedTags.map(tag => {
                const s = getTagStyle(tag);
                return (
                  <span key={tag} className="tag-pill"
                    style={{ background:s.bg, color:s.text, borderColor:s.border }}>
                    {tag}
                  </span>
                );
              })
            ) : (
              <div className="overlay-tags-hint">
                {ALL_TAGS.map(tag => {
                  const s = getTagStyle(tag);
                  return (
                    <span key={tag} className="tag-pill"
                      style={{ background:s.bg, color:s.text, borderColor:s.border }}>
                      {tag}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          <div className="overlay-actions">
            <button
              className={`overlay-save-btn${hasText ? " visible" : ""}`}
              onClick={handleSave}
              disabled={saving}
            >
              Save <kbd className="overlay-kbd">↵</kbd>
            </button>
            <div className="overlay-hints">
              <span><kbd>Shift+↵</kbd> Newline</span>
              <span><kbd>Esc</kbd> Cancel</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}