import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { pagesFunctions } from './tools/pagesFunctions.ts';

/**
 * The dev server mounts `functions/` in-process (see tools/pagesFunctions.ts) so the whole
 * stack runs with one command on Node 20; `wrangler` is still what deploys to Cloudflare.
 */
export default defineConfig({
  plugins: [react(), tailwindcss(), pagesFunctions()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: true,
    rollupOptions: {
      output: {
        // Keep the heavy, lazily-imported parsers in their own chunks so they never
        // land in the initial bundle.
        manualChunks(id) {
          if (id.includes('pdfjs-dist')) return 'pdf-parser';
          if (id.includes('mammoth')) return 'docx-parser';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
});
