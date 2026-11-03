import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The site is served by the worker itself at /golf (iii's HTTP port).
// `pnpm dev:web` starts Vite with HMR and proxies /golf/api to iii.
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
