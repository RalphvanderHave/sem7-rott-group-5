import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    host: true,
    port: 5173,
    allowedHosts: [
      "desktop-gl4mk9o.tailb2509f.ts.net"
    ]
  }
})
