import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// O site e servido pelo proprio worker em /golf (porta HTTP do iii).
// `pnpm dev:web` sobe o Vite com HMR e encaminha /golf/api para o iii.
export default defineConfig({
  root: 'web',
  base: '/golf/',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
  },
  server: {
    proxy: {
      '/golf/api': {
        target: process.env.III_HTTP_URL ?? 'http://127.0.0.1:3111',
        changeOrigin: true,
      },
    },
  },
})
