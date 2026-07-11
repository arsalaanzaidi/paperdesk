import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // pdfjs-dist ships an ESM worker we import as a URL; keep it un-inlined.
  build: {
    target: 'es2020',
  },
})
