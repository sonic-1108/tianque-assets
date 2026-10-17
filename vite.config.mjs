import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { hashTable, ITER } from './tools/admin-codes.mjs';

// build stamp (Chicago time), shown in the HUD so you can tell at a glance whether the page is the latest version
const stamp = new Date().toLocaleString('zh-CN', { timeZone: 'America/Chicago', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export default defineConfig({
  base: './',
  plugins: [
    react(),
    // version.json beside the page: the running game polls it (never cached) to notice a newer deploy
    { name: 'tq-version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: stamp }) }); } },
  ],
  define: {
    __BUILD__: JSON.stringify(stamp),
    // admin.html passcode: slow hashes of each day's code (null when ADMIN_SEED isn't set: the page stays open)
    __ADMIN__: JSON.stringify(process.env.ADMIN_SEED ? { iter: ITER, days: hashTable(process.env.ADMIN_SEED) } : null),
  },
  // two pages: the game, and admin.html (who's online right now)
  build: { rollupOptions: { input: { main: 'index.html', admin: 'admin.html', preview: 'preview.html' } } },
});
