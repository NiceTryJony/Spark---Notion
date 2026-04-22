import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

const appWindow = getCurrentWindow();

console.log("Toast component mounted, window label:", getCurrentWindow().label);

// Rust эмитит либо строку (старый формат), либо { content, tag }
interface ToastPayload {
  content: string;
  tag?: string;
}

export default function Toast() {
  const [text, setText]       = useState("");
  const [tag, setTag]         = useState("#link");
  const [visible, setVisible] = useState(false);
  const [hiding, setHiding]   = useState(false);

  // Храним таймеры чтобы сбрасывать при повторном вызове
  const hideTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unlisten = listen<string | ToastPayload>("show-toast", async (event) => {
      // Поддерживаем оба формата payload: строка и объект
      const raw = event.payload;
      const content = typeof raw === "string" ? raw : raw.content;
      const tagVal  = typeof raw === "string" ? "#link" : (raw.tag ?? "#link");

      const preview = content.length > 42 ? content.slice(0, 42) + "…" : content;
      setText(preview);
      setTag(tagVal);

      // Сбрасываем предыдущие таймеры если тост пришёл снова
      if (hideTimer.current)  clearTimeout(hideTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);

      // Позиционируем в правый нижний угол с учётом DPI
      const dpr     = window.devicePixelRatio || 1;
      const screenW = window.screen.width  / dpr;
      const screenH = window.screen.height / dpr;
      await appWindow.setPosition(new LogicalPosition(screenW - 320, screenH - 96));

      // Сначала показываем окно, потом запускаем анимацию
      await appWindow.show();
      setHiding(false);
      setVisible(true);

      // 2.2s — начинаем анимацию исчезновения
      hideTimer.current = setTimeout(() => {
        setHiding(true);
        // 300ms — скрываем окно после анимации
        closeTimer.current = setTimeout(async () => {
          setVisible(false);
          await appWindow.hide();
        }, 300);
      }, 2200);
    });

    return () => {
      unlisten.then(fn => fn());
      if (hideTimer.current)  clearTimeout(hideTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <div
      className="toast-root"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible && !hiding
          ? "translateY(0) scale(1)"
          : "translateY(12px) scale(0.96)",
      }}
    >
      <div className="toast-card">
        <div className="toast-icon">
          <span className="toast-dot" />
        </div>
        <div className="toast-body">
          <div className="toast-title">Clipped</div>
          <div className="toast-preview">{text}</div>
        </div>
        <div className="toast-tag">{tag}</div>
      </div>
    </div>
  );
}