import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.TOURWERK_API ?? 'http://127.0.0.1:4600';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5200),
    strictPort: true,
    proxy: {
      '/api': api,
      '/socket.io': { target: api, ws: true },
    },
  },
  preview: { port: 5200 },
});
