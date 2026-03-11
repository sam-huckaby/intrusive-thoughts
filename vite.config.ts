import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { join } from "path";

export default defineConfig({
  root: join(__dirname, "web"),
  plugins: [tailwindcss()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3456",
    },
  },
});
