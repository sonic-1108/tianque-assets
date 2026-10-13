import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// build stamp (Chicago time), shown in the HUD so you can tell at a glance whether the page is the latest version
const stamp = new Date().toLocaleString('zh-CN', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __BUILD__: JSON.stringify(stamp) },
  // two pages: the game, and admin.html (who's online right now)
  build: { rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } },
});
