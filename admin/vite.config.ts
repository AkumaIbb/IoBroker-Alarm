import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '.',
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(__dirname, 'src', 'index_m.html'),
    },
  },
});
