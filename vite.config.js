import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Project pages are served from /<repo>/, so every asset URL needs that prefix.
export default defineConfig({
  plugins: [react()],
  base: "/oakleaf-bakery/",
});
