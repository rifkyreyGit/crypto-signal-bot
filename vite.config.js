import { defineConfig } from 'vite';

export default defineConfig({
  // Dev di browser: proxy ke Indodax supaya tidak kena CORS. Di APK, CapacitorHttp yang menangani.
  server: { proxy: {
    '/indodax': { target: 'https://indodax.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/indodax/, '') },
    '/bot': { target: 'http://127.0.0.1:8080', rewrite: (p) => p.replace(/^\/bot/, '') },  // uji tab Bot lokal
  } },
  build: { target: 'es2022' },
});
