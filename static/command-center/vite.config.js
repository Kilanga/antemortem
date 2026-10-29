import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Forge serves the built files from a path it controls, so every asset URL
// must be relative (base: './'). Output goes to dist/, which manifest.yml
// points at via `resources.command-center.path`.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
  },
});
