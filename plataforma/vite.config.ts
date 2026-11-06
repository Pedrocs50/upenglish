import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // CF_PAGES_COMMIT_SHA: o commit publicado (o Cloudflare informa no build), mostrado no monitor de erros.
  envPrefix: ["VITE_", "CF_PAGES_COMMIT_"],
  // O pacote principal (~510 KB, ~150 KB comprimido) é a base: React, roteamento e Supabase.
  // As telas internas e o encoder de MP3 já são carregados sob demanda.
  build: { chunkSizeWarningLimit: 600 },
});
