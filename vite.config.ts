import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 纯前端静态站点；服务器仅托管静态文件与健康检查，不参与任何计算
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    sourcemap: true,
  },
  worker: {
    format: 'es',
  },
  preview: {
    host: '0.0.0.0',
    port: 8080,
  },
});
