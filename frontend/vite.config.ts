import { defineConfig } from 'vite';
import react            from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // Em dev, proxeia chamadas API e WS para o Kong local
      '/games':   { target: 'http://localhost:8000', changeOrigin: true },
      '/wallets': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
  build: {
    outDir:      'dist',
    sourcemap:   true,
    target:      'es2022',
  },
});
