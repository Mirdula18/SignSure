#!/usr/bin/env node
/**
 * Enforces the initial-JS budget from docs/ARCHITECTURE.md section 10.
 *
 * "Initial" means only what index.html loads before any user interaction: the lazily imported
 * PDF and DOCX parsers are deliberately excluded and are checked separately for being split out.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join } from 'node:path';

const DIST = 'dist';
const BUDGET_KB = 180;
const LAZY_CHUNKS = ['pdf-parser', 'docx-parser'];

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
const assets = readdirSync(join(DIST, 'assets'));

// Everything statically reachable from the entry is preloaded by Vite via modulepreload.
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

const lazy = assets
  .filter((f) => f.endsWith('.js') && LAZY_CHUNKS.some((c) => f.startsWith(c)))
  .map((f) => [`assets/${f}`, gzipKb(join(DIST, 'assets', f))]);

const css = assets
  .filter((f) => f.endsWith('.css'))
  .reduce((sum, f) => sum + gzipKb(join(DIST, 'assets', f)), 0);

const fmt = (n) => `${n.toFixed(1)} kB`;
console.log('Initial JavaScript (gzip):');
for (const [name, kb] of rows) console.log(`  ${name.padEnd(46)} ${fmt(kb)}`);
console.log(`  ${'TOTAL'.padEnd(46)} ${fmt(total)}  (budget ${BUDGET_KB} kB)`);
console.log(`CSS (gzip): ${fmt(css)}`);

if (lazy.length > 0) {
  console.log('Lazy chunks (not in the initial load):');
  for (const [name, kb] of lazy) console.log(`  ${name.padEnd(46)} ${fmt(kb)}`);
}

const inlinedParser = rows.find(([name]) => LAZY_CHUNKS.some((c) => name.includes(c)));
if (inlinedParser) {
  console.error(`\nFAIL: ${inlinedParser[0]} is in the initial load but must be lazy-imported.`);
  process.exit(1);
}

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
