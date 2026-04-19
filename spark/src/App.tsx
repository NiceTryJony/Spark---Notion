import { getCurrentWindow } from "@tauri-apps/api/window";
import "./index.css";
import Library from "./pages/Library";
import Overlay from "./pages/Overlay";
import Toast from "./pages/Toast";

const windowLabel = getCurrentWindow().label;

export default function App() {
  if (windowLabel === "overlay") return <Overlay />;
  if (windowLabel === "library") return <Library />;
  if (windowLabel === "toast") return <Toast />;

  return (
    <div style={{ color: "red", padding: 20 }}>
      Unknown window: {windowLabel}
    </div>
  );
}