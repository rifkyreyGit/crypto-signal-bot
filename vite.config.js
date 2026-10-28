import { defineConfig } from 'vite';

export default defineConfig({
  // Dev di browser: proxy ke Indodax supaya tidak kena CORS. Di APK, CapacitorHttp yang menangani.
  server: { proxy: { '/indodax': { target: 'https://indodax.com', changeOrigin: true, rewrite: (p) => p.replace(/^\/indodax/, '') } } },
  build: { target: 'es2022' },
});
