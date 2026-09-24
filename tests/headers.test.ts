import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Pins the security headers Cloudflare Pages serves from `public/_headers`.
 *
 * `vite preview` serves the same `/*` block (vite.config.ts), so the E2E suite runs under this
 * CSP too; this test pins its exact values. docs/SECURITY.md section 4 still asks for a check of
 * the live headers before each submission.
 */

const ROOT = join(import.meta.dirname, '..');
const HEADERS_FILE = readFileSync(join(ROOT, 'public', '_headers'), 'utf8');

/** Parses the `_headers` format: an unindented path line, then indented `Name: value` lines. */
function parseHeaders(text: string): Map<string, Map<string, string>> {
  const rules = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = new Map();
      rules.set(line.trim(), current);
      continue;
    }
    const colon = line.indexOf(':');
    if (current === null || colon === -1) throw new Error(`Unparseable _headers line: ${line}`);
    current.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
  }
  return rules;
}

function directives(csp: string): Map<string, string[]> {
  return new Map(
    csp
      .split(';')
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0] !== undefined && tokens[0] !== '')
      .map(([name = '', ...values]) => [name, values]),
  );
}

const RULES = parseHeaders(HEADERS_FILE);
const SITE = RULES.get('/*') ?? new Map<string, string>();
const CSP = directives(SITE.get('content-security-policy') ?? '');

describe('public/_headers', () => {
  it('sends a Content-Security-Policy on every page', () => {
    expect(SITE.has('content-security-policy')).toBe(true);
  });

  it('allows scripts only from this site, never inline, eval or a third party', () => {
    expect(CSP.get('script-src')).toEqual(["'self'"]);
    for (const values of CSP.values()) {
      expect(values).not.toContain("'unsafe-eval'");
    }
  });

  it('lets the browser talk only to our own API, because Gemini is called from the server', () => {
    expect(CSP.get('connect-src')).toEqual(["'self'"]);
  });

  it('shuts the doors a CSP is usually bypassed through', () => {
    expect(CSP.get('default-src')).toEqual(["'self'"]);
    expect(CSP.get('object-src')).toEqual(["'none'"]);
    expect(CSP.get('base-uri')).toEqual(["'self'"]);
    expect(CSP.get('form-action')).toEqual(["'self'"]);
    expect(CSP.get('frame-ancestors')).toEqual(["'none'"]);
    expect(CSP.get('frame-src')).toEqual(["'none'"]);
  });

  it('allows blob workers only because pdf.js needs one', () => {
    expect(CSP.get('worker-src')).toEqual(["'self'", 'blob:']);
  });

  it('sends the other hardening headers', () => {
    expect(SITE.get('x-content-type-options')).toBe('nosniff');
    expect(SITE.get('x-frame-options')).toBe('DENY');
    expect(SITE.get('strict-transport-security')).toMatch(/max-age=\d{7,}/);
    expect(SITE.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(SITE.get('permissions-policy')).toContain('camera=()');
  });

  it('never lets an API response be cached', () => {
    expect(RULES.get('/api/*')?.get('cache-control')).toBe('no-store');
  });

  it('revalidates the service worker and its loader on every visit, so an update is never missed', () => {
    for (const path of ['/sw.js', '/registerSW.js', '/manifest.webmanifest']) {
      expect(RULES.get(path)?.get('cache-control')).toBe('no-cache');
    }
  });
});

describe('index.html', () => {
  it('has no inline script, which the CSP would block anyway', () => {
    const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
    expect(scripts.length).toBeGreaterThan(0);
    for (const [, attributes = '', body = ''] of scripts) {
      expect(attributes).toMatch(/\bsrc=/);
      expect(body.trim()).toBe('');
    }
  });
});
