import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 1420,
    strictPort: true,
    host: "localhost",
  },
  build: {
    target: ["es2021", "chrome100", "safari13"],
  },
});