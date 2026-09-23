/**
 * Runs the golden set through the real pipeline and scores it: `npm run eval`.
 *
 * Every request goes over HTTP to the same Pages Functions the browser talks to, so the numbers
 * include everything between the model and the screen: Zod validation, clause-id checks, quote
 * verification, the rule engine and the missing-information rules.
 *
 * Usage:
 *   npm run eval                    real Gemini; needs GEMINI_API_KEY in .dev.vars or the env
 *   npm run eval -- --mock          the fixture model, to check the harness itself
 *   npm run eval -- --only bond-heavy --pace 8000
 *
 * Do not run this in CI: it spends real API quota and its results vary from run to run.
 * Results are written to eval-results/ (gitignored).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { createServer } from 'vite';
import type { z } from 'zod';
import {
  analyzeResponseSchema,
  apiErrorSchema,
  askResponseSchema,
  sessionResponseSchema,
} from '../shared/schemas.ts';
import { acceptableStatuses, clauseByLabel, loadGoldenSet } from '../tests/golden.ts';
import {
  computeMetrics,
  formatRate,
  gateFailures,
  type ContractRun,
  type EvalMetrics,
  type Latency,
  type QuestionRun,
} from '../tests/evalMetrics.ts';

const REQUEST_TIMEOUT_MS = 120_000;

const { values: args } = parseArgs({
  options: {
    mock: { type: 'boolean', default: false },
    only: { type: 'string' },
    // Free-tier Gemini allows a handful of requests a minute; pacing keeps a run inside it.
    pace: { type: 'string' },
  },
});

const mock = args.mock;
const paceMs = Number(args.pace ?? (mock ? '0' : '6000'));

// The functions read configuration per request from .dev.vars overlaid with process.env, so
// these win over anything in .dev.vars. The session secret and salt are throwaway values that
// exist only for this run; the Gemini key, if any, is left exactly where the developer put it.
process.env.MOCK_GEMINI = mock ? 'true' : 'false';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
process.env.IP_HASH_SALT = randomBytes(16).toString('hex');

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Parsed<T> = { ok: true; data: T; ms: number } | { ok: false; error: string; ms: number };

async function call<T>(
  base: string,
  path: string,
  body: unknown,
  schema: z.ZodType<T>,
  headers: Record<string, string>,
): Promise<Parsed<T>> {
  const started = performance.now();
  try {
    const response = await fetch(new URL(path, base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json: unknown = await response.json();
    const ms = Math.round(performance.now() - started);
    if (!response.ok) {
      const envelope = apiErrorSchema.safeParse(json);
      const code = envelope.success ? envelope.data.error.code : 'unrecognised error body';
      return { ok: false, error: `HTTP ${String(response.status)} ${code}`, ms };
    }
    const parsed = schema.safeParse(json);
    return parsed.success
      ? { ok: true, data: parsed.data, ms }
      : { ok: false, error: 'response did not match the schema', ms };
  } catch (error) {
    const ms = Math.round(performance.now() - started);
    return { ok: false, error: error instanceof Error ? error.message : String(error), ms };
  }
}

function formatLatency(latency: Latency): string {
  const seconds = (ms: number | null) => (ms === null ? 'n/a' : `${(ms / 1000).toFixed(1)}s`);
  return `p50 ${seconds(latency.p50)} · p95 ${seconds(latency.p95)}`;
}

function report(metrics: EvalMetrics): void {
  const rows: [string, string][] = [
    ['Quote verification (target ≥95%)', formatRate(metrics.quoteVerification)],
    ['Refusal accuracy (target 100%)', formatRate(metrics.refusalAccuracy)],
    ['Answer status accuracy', formatRate(metrics.statusAccuracy)],
    ['Category recall', formatRate(metrics.categoryRecall)],
    ['Rule recall', formatRate(metrics.ruleRecall)],
    ['Missing-information recall', formatRate(metrics.missingInfoRecall)],
    ['Answered-citation precision', formatRate(metrics.citationPrecision)],
    ['Analyze latency', formatLatency(metrics.latency.analyze)],
    ['Ask latency', formatLatency(metrics.latency.ask)],
  ];
  const width = Math.max(...rows.map(([label]) => label.length));
  console.log('');
  for (const [label, value] of rows) console.log(`  ${label.padEnd(width)}  ${value}`);

  const lists: [string, string[]][] = [
    ['Missed categories', metrics.missedCategories],
    ['Missed rules', metrics.missedRules],
    ['Flags that should not have been raised', metrics.falseFlags],
    ['Reported missing but present', metrics.falseMissing],
    ['Wrong answer status', metrics.wrongStatuses],
    ['Prompt-injection violations', metrics.injectionViolations],
    ['Failed requests', metrics.failures],
  ];
  for (const [title, items] of lists) {
    if (items.length === 0) continue;
    console.log(`\n  ${title}:`);
    for (const item of items) console.log(`    - ${item}`);
  }
  console.log('');
}

async function main(): Promise<number> {
  const golden = loadGoldenSet().filter(
    (contract) => args.only === undefined || contract.name === args.only,
  );
  if (golden.length === 0) {
    console.error(`No golden contract is called "${args.only ?? ''}".`);
    return 2;
  }

  const server = await createServer({
    server: { port: 5190, strictPort: false, host: '127.0.0.1', hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    clearScreen: false,
    logLevel: 'warn',
  });
  await server.listen();
  const base = server.resolvedUrls?.local[0];

  try {
    if (base === undefined) throw new Error('The eval server did not report a URL');
    const health = (await (await fetch(new URL('/api/health', base))).json()) as {
      configured?: { gemini?: boolean };
    };
    if (health.configured?.gemini !== true) {
      console.error(
        'No Gemini key found. Put GEMINI_API_KEY in .dev.vars (see .dev.vars.example), or run\n' +
          'npm run eval -- --mock to exercise the harness with the fixture model.',
      );
      return 2;
    }

    console.log(
      `SignSure eval · ${mock ? 'MOCK model (checks the harness, not the model)' : 'live Gemini'} · ` +
        `${String(golden.length)} contract(s)`,
    );

    const runs: ContractRun[] = [];
    for (const [index, contract] of golden.entries()) {
      // A distinct documentation-range address per contract keeps each inside its own rate limit.
      const ip = { 'CF-Connecting-IP': `203.0.113.${String(index + 10)}` };
      const expected = contract.expected;
      const expectations = {
        contract: contract.name,
        mustFindCategories: expected.mustFindCategories,
        mustFlagRules: expected.mustFlagRules,
        mustNotFlagRules: expected.mustNotFlagRules,
        mustReportMissing: expected.mustReportMissing,
        mustNotReportMissing: expected.mustNotReportMissing,
        forbiddenClauseIds: expected.forbiddenClauseIds ?? [],
        forbiddenVerifiedQuotes: expected.forbiddenVerifiedQuotes ?? [],
      };

      const session = await call(base, '/api/session', {}, sessionResponseSchema, ip);
      if (!session.ok) {
        runs.push({
          ...expectations,
          analysis: null,
          analyzeMs: 0,
          analyzeError: `session: ${session.error}`,
          questions: [],
        });
        continue;
      }
      const headers = { ...ip, authorization: `Bearer ${session.data.token}` };
      const request = { clauses: contract.clauses, language: 'en', readingLevel: 'standard' };

      process.stdout.write(`  ${contract.name}: analyze`);
      const analysis = await call(
        base,
        '/api/analyze',
        { ...request, lenses: [] },
        analyzeResponseSchema,
        headers,
      );
      process.stdout.write(
        analysis.ok ? ` ${String(analysis.ms)}ms` : ` FAILED (${analysis.error})`,
      );

      const questions: QuestionRun[] = [];
      for (const question of expected.questions) {
        await pause(paceMs);
        const asked = await call(
          base,
          '/api/ask',
          { ...request, question: question.q },
          askResponseSchema,
          headers,
        );
        process.stdout.write(asked.ok ? ` · ask ${asked.data.status}` : ` · ask FAILED`);
        questions.push({
          q: question.q,
          acceptable: acceptableStatuses(question),
          expectedClauseIds: (question.clauseLabels ?? []).map(
            (label) => clauseByLabel(contract.clauses, label).id,
          ),
          ...(question.forbidVerifiedQuote === undefined
            ? {}
            : { forbidVerifiedQuote: question.forbidVerifiedQuote }),
          result: asked.ok ? asked.data : null,
          ms: asked.ms,
          ...(asked.ok ? {} : { error: asked.error }),
        });
      }
      process.stdout.write('\n');

      runs.push({
        ...expectations,
        analysis: analysis.ok ? analysis.data : null,
        analyzeMs: analysis.ms,
        ...(analysis.ok ? {} : { analyzeError: analysis.error }),
        questions,
      });
      if (index < golden.length - 1) await pause(paceMs);
    }

    const metrics = computeMetrics(runs);
    report(metrics);

    mkdirSync('eval-results', { recursive: true });
    const file = join(
      'eval-results',
      `eval-${mock ? 'mock-' : ''}${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    writeFileSync(file, JSON.stringify({ mock, metrics, runs }, null, 2));
    console.log(`  Full results: ${file}`);

    const failures = gateFailures(metrics);
    if (mock) {
      // The fixture model is not being evaluated, so only plumbing failures fail a mock run.
      if (metrics.failures.length > 0) return 1;
      console.log(
        '  Mock run: targets are informational; the harness and pipeline ran end to end.',
      );
      return 0;
    }
    if (failures.length > 0) {
      console.log('\n  FAILED:');
      for (const reason of failures) console.log(`    - ${reason}`);
      return 1;
    }
    console.log('  PASSED: every target met.');
    return 0;
  } finally {
    await server.close();
  }
}

process.exitCode = await main();
