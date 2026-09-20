#!/usr/bin/env node
/**
 * Fails the build if anything that looks like a live credential is tracked in git.
 *
 * Why a script rather than a grep in CI: the same check has to be runnable locally before a
 * commit, on Windows as well as Linux, and it needs to allow the documented Cloudflare test
 * keys (which are public by design) without allowing real ones.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{20,}/ },
  { name: 'Google OAuth client secret', re: /GOCSPX-[0-9A-Za-z_-]{20,}/ },
  { name: 'Private key block', re: /-----BEGIN (RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'AWS access key id', re: /AKIA[0-9A-Z]{16}/ },
  { name: 'Slack token', re: /xox[baprs]-[0-9A-Za-z-]{10,}/ },
  {
    name: 'Generic bearer secret assignment',
    re: /(api[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9_-]{32,}['"]/i,
  },
];

/** Cloudflare publishes these as always-pass / always-fail test values. */
const ALLOWED = [
  '1x00000000000000000000AA',
  '1x0000000000000000000000000000000AA',
  '2x00000000000000000000AB',
  '2x0000000000000000000000000000000AA',
  '3x00000000000000000000FF',
];

const SKIP_PATH = /^(package-lock\.json|.*\.(png|jpg|jpeg|gif|webp|svg|ico|pdf|woff2?))$/i;

const files = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter(Boolean)
  .filter((f) => !SKIP_PATH.test(f));

const findings = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  // The scanner's own pattern list would otherwise match itself.
  if (file === 'scripts/secret-scan.mjs') continue;
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (ALLOWED.some((allowed) => line.includes(allowed))) return;
    for (const { name, re } of PATTERNS) {
      if (re.test(line)) findings.push(`${file}:${index + 1}  ${name}`);
    }
  });
}

if (findings.length > 0) {
  console.error('Possible secrets found in tracked files:\n' + findings.join('\n'));
  process.exit(1);
}
console.log(`Secret scan clean (${files.length} tracked files checked).`);
