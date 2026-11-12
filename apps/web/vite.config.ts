import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // In dev, Vite proxies /api to the local API so the browser sees one origin
    // (no CORS config). In Docker, nginx does the same job.
    proxy: { '/api': 'http://localhost:3000' },
  },
});
