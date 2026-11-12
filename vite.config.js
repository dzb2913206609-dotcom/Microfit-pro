import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 10000,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('plotly')) return 'vendor-plotly'
          if (id.includes('recharts')) return 'vendor-recharts'
          if (id.includes('katex')) return 'vendor-katex'
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react'
        },
      },
    },
  },
})
