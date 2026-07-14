import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'app/renderer',
  base: './',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'terser',
    terserOptions: {
      compress: { drop_console: true },
    },
    rollupOptions: {
      input: 'app/renderer/index.html',
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve('app/renderer/src/shared'),
      '@modules': path.resolve('app/renderer/src/modules'),
      '@config': path.resolve('config'),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: 'localhost',
  },
});
