import { getCurrentWindow, LogicalPosition } from "@tauri-apps/api/window";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";

const appWindow = getCurrentWindow();

export default function Toast() {
  const [text, setText] = useState("");
  const [visible, setVisible] = useState(false);
  const [hiding, setHiding] = useState(false);

  useEffect(() => {
    // Слушаем событие от Rust
    const unlisten = listen<string>("show-toast", async (event) => {
      const content = event.payload;
      // Обрезаем длинный текст для превью
      const preview = content.length > 42 ? content.slice(0, 42) + "…" : content;
      setText(preview);

      // Позиционируем окно в правый нижний угол
      // const screenW = window.screen.width;
      // const screenH = window.screen.height;
       const dpr = window.devicePixelRatio || 1;
       const screenW = window.screen.width  / dpr;
       const screenH = window.screen.height / dpr;
      // 300 = ширина окна, 64 = высота, 20 = отступ от края
      await appWindow.setPosition(
        new LogicalPosition(screenW - 320, screenH - 96)
      );

      setHiding(false);
      setVisible(true);
      await appWindow.show();

      // Через 2.2s начинаем hide-анимацию
      setTimeout(() => {
        setHiding(true);
        // После анимации (300ms) скрываем окно
        setTimeout(async () => {
          setVisible(false);
          await appWindow.hide();
        }, 300);
      }, 2200);
    });

    return () => {
      unlisten.then((fn) => fn());
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
        <div className="toast-tag">#link</div>
      </div>
    </div>
  );
}
