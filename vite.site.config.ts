import { resolve } from 'node:path'

import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig(({ command }) => ({
  plugins: [react()],
  root: resolve(__dirname, 'site'),
  publicDir: false,
  base: command === 'serve' ? '/' : '/privacy-filter/',
  clearScreen: false,
  server: {
    host: '0.0.0.0',
    port: 4174,
    strictPort: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 4175,
    strictPort: true,
  },
  build: {
    outDir: resolve(__dirname, 'site-dist'),
    emptyOutDir: true,
  },
}))
