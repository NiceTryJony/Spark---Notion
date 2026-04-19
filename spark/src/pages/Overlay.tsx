import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ALL_TAGS, extractTags, getTagStyle } from "../lib/notes";
import { useNotesStore } from "../store/notesStore";

const appWindow = getCurrentWindow();

export default function Overlay() {
  const [value, setValue]   = useState("");
  const [saving, setSaving] = useState(false);
  const [flash, setFlash]   = useState(false);
  const textareaRef         = useRef<HTMLTextAreaElement>(null);

  // ── derived state — no separate useState/useEffect needed ─────────────────
  const detectedTags = useMemo(() => extractTags(value), [value]);
  const hasText      = value.trim().length > 0;

  const saveNote = useNotesStore((s) => s.saveNote);

  // ── focus on show ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const focus = () => {
      setValue("");
      // rAF is more reliable than a magic setTimeout(50) for Tauri windows
      requestAnimationFrame(() => {
        if (!cancelled) textareaRef.current?.focus();
      });
    };

    focus();

    // onFocusChanged returns a Promise<UnlistenFn>
    const unlistenPromise = appWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) focus();
    });

    return () => {
      cancelled = true;
      // Guard: resolve and call only if component is still alive at that point
      unlistenPromise.then((fn) => fn());
    };
  }, []);

  // ── auto-resize textarea ───────────────────────────────────────────────────
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  // ── save ───────────────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (!hasText || saving) return;
    setSaving(true);
    setFlash(true);

    try {
      await saveNote(value.trim(), detectedTags);
      setValue("");
      // Hide after the flash animation (~180 ms feels snappy)
      setTimeout(() => appWindow.hide(), 180);
    } catch (err) {
      // Window stays open so the user can retry
      console.error("save error:", err);
      setFlash(false);
    } finally {
      setSaving(false);
    }
  }, [hasText, saving, value, detectedTags, saveNote]);

  // ── keyboard ───────────────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSave(); }
      if (e.key === "Escape") appWindow.hide();
    },
    [handleSave]
  );

  // ── render ─────────────────────────────────────────────────────────────────
  return (
    <div className="overlay-root">
      <div className={`overlay-card${flash ? " flash" : ""}`}>
        {/* Header */}
        <div className="overlay-header">
          <div className="overlay-logo">
            <span className="dot" />
            <span>spark</span>
          </div>
          <button
            className="overlay-close"
            onClick={() => appWindow.hide()}
            title="Esc"
          >
            ✕
          </button>
        </div>

        {/* Input */}
        <textarea
          ref={textareaRef}
          className="overlay-input"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write your thought..."
          rows={3}
        />

        {/* Footer */}
        <div className="overlay-footer">
          <div className="overlay-tags">
            {detectedTags.length > 0 ? (
              detectedTags.map((tag) => {
                const s = getTagStyle(tag);
                return (
                  <span
                    key={tag}
                    className="tag-pill"
                    style={{ background: s.bg, color: s.text, borderColor: s.border }}
                  >
                    {tag}
                  </span>
                );
              })
            ) : (
              <div className="overlay-tags-hint">
                {ALL_TAGS.map((tag) => {
                  const s = getTagStyle(tag);
                  return (
                    <span
                      key={tag}
                      className="tag-pill"
                      style={{ background: s.bg, color: s.text, borderColor: s.border }}
                    >
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
              Save{" "}
              <kbd className="overlay-kbd">↵</kbd>
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