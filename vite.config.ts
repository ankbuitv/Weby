import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

/**
 * Two renderer entries share one bundle graph:
 *   `index.html` → PREP shell
 *   `live.html`  → LIVE audience surface *and* the transparent overlay view
 *                  (the role comes from `--juzt-role=`, so the overlay is the
 *                  same document with a different preload surface).
 *
 * The live entry is also reachable through the dev server as `live.html`, which
 * is what `windows.loadRenderer()` requests in both modes.
 */
export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: './',
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, 'src/renderer/index.html'),
        live: path.resolve(__dirname, 'src/renderer/live.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
