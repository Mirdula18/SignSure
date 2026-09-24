import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { pagesFunctions } from './tools/pagesFunctions.ts';

/**
 * The `/*` block of public/_headers, so `vite preview` - and so the E2E suite - serves the same
 * CSP and security headers as Cloudflare Pages. HSTS and `upgrade-insecure-requests` are left
 * out because preview runs over plain http on localhost, where both would break every request.
 */
function pagesHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  let inRoot = false;
  const file = readFileSync(new URL('./public/_headers', import.meta.url), 'utf8');
  for (const line of file.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      inRoot = line.trim() === '/*';
      continue;
    }
    const match = /^\s+([\w-]+):\s*(.+)$/.exec(line);
    if (!inRoot || !match?.[1] || !match[2] || match[1] === 'Strict-Transport-Security') continue;
    headers[match[1]] = match[2].replace(/;\s*upgrade-insecure-requests/, '');
  }
  return headers;
}

/**
 * The dev server mounts `functions/` in-process (see tools/pagesFunctions.ts) so the whole
 * stack runs with one command; `wrangler` is still what deploys to Cloudflare.
 */
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    pagesFunctions(),
    VitePWA({
      // A new version waits until every SignSure tab is closed, so a reader half-way through a
      // report never has the code swapped underneath them.
      registerType: 'prompt',
      injectRegister: 'script',
      manifest: {
        name: 'SignSure',
        short_name: 'SignSure',
        description: 'Understand every clause of your offer letter before you sign.',
        theme_color: '#1d4ed8',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        // The app shell: everything a return visit needs before a document is chosen.
        globPatterns: ['**/*.{js,css,html}'],
        // The PDF and Word readers are most of the bytes and only someone uploading that kind of
        // file needs them, so they stay out of the install-time download and are cached on
        // first use instead (runtimeCaching below).
        globIgnores: ['**/pdfjs-*.js', '**/pdf.worker*', '**/mammoth-*.js'],
        runtimeCaching: [
          {
            urlPattern: /\/assets\/(pdfjs|pdf\.worker\.min|mammoth)-[\w-]+\.m?js$/,
            handler: 'CacheFirst',
            // Hashed file names, so a cached copy can never be stale; the cap drops old releases.
            options: { cacheName: 'signsure-parsers', expiration: { maxEntries: 6 } },
          },
        ],
        // API calls are POSTs, which a service worker never caches, and a navigation to /api
        // must reach the Functions rather than be answered with the cached app shell.
        navigateFallbackDenylist: [/^\/api\//],
        cleanupOutdatedCaches: true,
        // The first install has no older version to protect, so it takes over the open page at
        // once: a PDF read on the very first visit already lands in the parser cache. Updates
        // still wait for every tab to close, because there is no skipWaiting.
        clientsClaim: true,
      },
    }),
  ],
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
        // Stable names for the two heavy parsers, so the service worker can leave them out of
        // the precache. Only the name changes: forcing modules into a named chunk instead
        // (manualChunks) moved a shared helper into pdf.js and pulled it into the first load.
        chunkFileNames(chunk) {
          const entry = chunk.facadeModuleId ?? '';
          if (entry.endsWith('/node_modules/pdfjs-dist/build/pdf.mjs'))
            return 'assets/pdfjs-[hash].js';
          if (entry.includes('/node_modules/mammoth/')) return 'assets/mammoth-[hash].js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
    headers: pagesHeaders(),
  },
});
