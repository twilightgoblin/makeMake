import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/songs': 'http://localhost:3000',
      '/rooms': 'http://localhost:3000',
    },
  },
})
