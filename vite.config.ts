import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // sqlite-wasm ships its own .wasm loader; pre-bundling breaks the asset URL resolution.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  server: {
    port: 5273,
    strictPort: true,
    // Rust build artifacts hold file locks the watcher cannot open.
    watch: { ignored: ['**/src-tauri/**'] },
  },
  // Tauri serves the bundle from a custom protocol; relative asset URLs keep working there.
  base: './',
  envPrefix: ['VITE_', 'TAURI_ENV_'],
});
