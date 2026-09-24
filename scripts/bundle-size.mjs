#!/usr/bin/env node
/**
 * Enforces the initial-JS budget from docs/ARCHITECTURE.md section 10.
 *
 * "Initial" means only what index.html loads before any interaction: the entry script plus
 * anything Vite adds a `modulepreload` link for. The PDF and DOCX parsers must not be in that
 * set, and the check for that looks for marker strings *inside* the initial chunks rather than
 * matching chunk filenames - a filename check passes happily when a bundler decision quietly
 * merges a parser into the entry, which is exactly the regression this is here to catch.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'dist';
const BUDGET_KB = 100;

/** Strings that only appear if the library itself was bundled in. */
const LAZY_LIBRARY_MARKERS = [
  { name: 'pdf.js', marker: 'PDFDocumentLoadingTask' },
  { name: 'mammoth', marker: 'extractRawText' },
  // Response validation only runs after the first API call, so Zod is fetched with it.
  { name: 'Zod', marker: 'ZodError' },
  // The Hindi dictionary loads when Hindi is chosen, the sample letter when it is asked for.
  { name: 'the Hindi dictionary', marker: 'यह नहीं हो पाया' },
  { name: 'the sample letter', marker: 'Head of People Operations' },
];

function gzipKb(path) {
  return gzipSync(readFileSync(path)).length / 1024;
}

let html;
try {
  html = readFileSync(join(DIST, 'index.html'), 'utf8');
} catch {
  console.error('dist/index.html not found. Run `npm run build` first.');
  process.exit(1);
}

const entrySrcs = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map((m) => m[1]);
const preloaded = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="([^"]+)"/g)].map(
  (m) => m[1],
);

const initial = [...new Set([...entrySrcs, ...preloaded])]
  .map((href) => href.replace(/^\//, ''))
  .filter((p) => p.endsWith('.js'));

let total = 0;
const rows = [];
for (const rel of initial) {
  const kb = gzipKb(join(DIST, rel));
  total += kb;
  rows.push([rel, kb]);
}

const assets = readdirSync(join(DIST, 'assets'));
const initialNames = new Set(initial.map((p) => p.replace(/^assets\//, '')));
const lazy = assets
  .filter((f) => (f.endsWith('.js') || f.endsWith('.mjs')) && !initialNames.has(f))
  .map((f) => [`assets/${f}`, gzipKb(join(DIST, 'assets', f))])
  .sort((a, b) => b[1] - a[1]);

const css = assets
  .filter((f) => f.endsWith('.css'))
  .reduce((sum, f) => sum + gzipKb(join(DIST, 'assets', f)), 0);

const fmt = (n) => `${n.toFixed(1)} kB`;
console.log('Initial JavaScript (gzip):');
for (const [name, kb] of rows) console.log(`  ${name.padEnd(46)} ${fmt(kb)}`);
console.log(`  ${'TOTAL'.padEnd(46)} ${fmt(total)}  (budget ${BUDGET_KB} kB)`);
console.log(`CSS (gzip): ${fmt(css)}`);

if (lazy.length > 0) {
  console.log('Lazy chunks (fetched only when needed):');
  for (const [name, kb] of lazy.slice(0, 8)) console.log(`  ${name.padEnd(46)} ${fmt(kb)}`);
}

// The check that actually matters: is a lazily-imported library sitting in the initial load?
const initialSource = initial.map((rel) => readFileSync(join(DIST, rel), 'utf8')).join('');
const leaked = LAZY_LIBRARY_MARKERS.filter(({ marker }) => initialSource.includes(marker));
if (leaked.length > 0) {
  console.error(
    `\nFAIL: ${leaked.map((l) => l.name).join(' and ')} ended up in the initial load. ` +
      'These must stay behind a dynamic import.',
  );
  process.exit(1);
}

// Vite copies the pdf.js worker as is, so importing the full build ships 2.2 MB unminified.
const fullWorker = assets.filter((f) => /^pdf\.worker-.*\.mjs$/.test(f));
if (fullWorker.length > 0) {
  console.error(
    `\nFAIL: ${fullWorker.join(', ')} is the unminified pdf.js worker. Import pdf.worker.min.mjs.`,
  );
  process.exit(1);
}

// The service worker downloads its precache on a first visit, in the background. The parsers
// must not be in it: they would triple that download for readers who never upload a file.
const serviceWorker = readFileSync(join(DIST, 'sw.js'), 'utf8');
const precached = [...serviceWorker.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
const precachedParsers = precached.filter((url) => /pdfjs-|pdf\.worker|mammoth-/.test(url));
if (precached.length === 0 || precachedParsers.length > 0) {
  console.error(
    precached.length === 0
      ? '\nFAIL: dist/sw.js lists no precache entries.'
      : `\nFAIL: the service worker precaches ${precachedParsers.join(', ')}. Parsers are cached on first use.`,
  );
  process.exit(1);
}
const precacheKb = [...new Set(precached)].reduce((sum, url) => sum + gzipKb(join(DIST, url)), 0);
console.log(`Service worker precache (gzip): ${fmt(precacheKb)} in ${precached.length} files`);

const distBytes = (function walk(dir) {
  let sum = 0;
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    const s = statSync(p);
    sum += s.isDirectory() ? walk(p) : s.size;
  }
  return sum;
})(DIST);
console.log(`dist/ on disk: ${(distBytes / 1024 / 1024).toFixed(2)} MB`);

if (total > BUDGET_KB) {
  console.error(`\nFAIL: initial JS ${fmt(total)} exceeds the ${BUDGET_KB} kB budget.`);
  process.exit(1);
}
console.log('\nBundle budget OK.');
