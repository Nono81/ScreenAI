import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: 'desktop',
  build: {
    outDir: '../dist-desktop',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'desktop/index.html'),
    },
    target: 'esnext',
    minify: false,
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5174,
    strictPort: true,
  },
});
