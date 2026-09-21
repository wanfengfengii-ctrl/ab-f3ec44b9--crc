import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Fully static build: no business backend exists or is contacted.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  worker: {
    format: 'es',
  },
});
