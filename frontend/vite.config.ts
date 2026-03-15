import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Change this to your Cloud Run URL for remote testing, or localhost for local dev
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/ws': { target: BACKEND_URL, ws: true, changeOrigin: true },
      '/api': { target: BACKEND_URL, changeOrigin: true },
      '/health': { target: BACKEND_URL, changeOrigin: true },
    },
  },
  build: {
    outDir: '../backend/static',
    emptyOutDir: true,
  },
})
