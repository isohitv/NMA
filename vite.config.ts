import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src/renderer',
  base: process.env.GITHUB_ACTIONS ? '/NMA/' : '/',
  build: {
    outDir: '../../dist/renderer',
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': 'http://localhost:3001' },
  },
});
