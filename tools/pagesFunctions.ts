import { readFileSync, existsSync } from 'node:fs';
import { createServer, type Plugin, type ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { MemoryKv } from './memoryKv.ts';

/**
 * Runs the Cloudflare Pages Functions in `functions/` inside the Vite dev/preview server.
 *
 * Why this exists: `wrangler pages dev` requires Node 22+, and we target Node 20, so without
 * this plugin there would be no way to run (or end-to-end test) the API locally. The routing
 * rules mirror Cloudflare's: `functions/_middleware.ts` wraps every request, and
 * `functions/api/<name>.ts` handles `/api/<name>` via `onRequest` or `onRequest<Method>`.
 * Production still runs the exact same files on the real Pages runtime.
 */

const API_PREFIX = '/api/';

function parseDevVars(): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const file of ['.dev.vars', '.dev.vars.example']) {
    if (!existsSync(file)) continue;
    for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (key in vars) continue; // .dev.vars wins over the example file
      vars[key] = line.slice(eq + 1).trim();
    }
    // Stop after the first file that exists so the example never overrides real values.
    if (file === '.dev.vars') break;
  }
  return vars;
}

async function toWebRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const url = new URL(req.url ?? '/', origin);
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else headers.set(key, value);
  }
  const method = req.method ?? 'GET';
  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    body = Buffer.concat(chunks);
  }
  return new Request(url, {
    method,
    headers,
    ...(body && body.length > 0 ? { body: new Uint8Array(body) } : {}),
  });
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  const buffer = Buffer.from(await response.arrayBuffer());
  res.end(buffer);
}

type PagesHandler = (context: Record<string, unknown>) => Response | Promise<Response>;

/** Pages gives handlers a `waitUntil`; nothing in SignSure defers work, so it is a no-op. */
const noWaitUntil = (): void => undefined;

function pickHandler(mod: Record<string, unknown>, method: string): PagesHandler | null {
  const capitalised = method.charAt(0).toUpperCase() + method.slice(1).toLowerCase();
  const specific = mod[`onRequest${capitalised}`];
  if (typeof specific === 'function') return specific as PagesHandler;
  const generic = mod.onRequest;
  if (typeof generic === 'function') return generic as PagesHandler;
  return null;
}

export function pagesFunctions(): Plugin {
  const kv = new MemoryKv();
  let loader: ViteDevServer | null = null;
  let ownLoader = false;

  const handle = async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    if (!path.startsWith(API_PREFIX) || loader === null) {
      next();
      return;
    }
    const route = path.slice(API_PREFIX.length).replace(/\/+$/, '');
    if (!/^[a-z][a-z0-9-]*$/.test(route)) {
      next();
      return;
    }
    const file = `./functions/api/${route}.ts`;
    if (!existsSync(file.slice(2))) {
      next();
      return;
    }

    try {
      const request = await toWebRequest(req, 'http://localhost:5173');
      const env = { ...parseDevVars(), ...process.env, RATE_LIMIT_KV: kv };
      const routeMod = (await loader.ssrLoadModule(file)) as Record<string, unknown>;
      const handler = pickHandler(routeMod, request.method);

      const runRoute = async (): Promise<Response> => {
        if (!handler) return new Response('Method Not Allowed', { status: 405 });
        return handler({
          request,
          env,
          params: {},
          data: {},
          waitUntil: noWaitUntil,
          next: runRoute,
        });
      };

      let response: Response;
      if (existsSync('functions/_middleware.ts')) {
        const mw = (await loader.ssrLoadModule('./functions/_middleware.ts')) as Record<
          string,
          unknown
        >;
        const mwHandler = pickHandler(mw, request.method);
        response = mwHandler
          ? await mwHandler({
              request,
              env,
              params: {},
              data: {},
              waitUntil: noWaitUntil,
              next: runRoute,
            })
          : await runRoute();
      } else {
        response = await runRoute();
      }
      await writeWebResponse(res, response);
    } catch (error) {
      // Dev-only surface: print so the developer sees the stack, return the production shape.
      console.error(`[pages-functions] ${path}`, error);
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          error: { code: 'INTERNAL', message: 'Something went wrong.', retryable: true },
        }),
      );
    }
  };

  return {
    name: 'signsure:pages-functions',
    apply: (_config, { command }) => command === 'serve',
    configureServer(server) {
      loader = server;
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    async configurePreviewServer(server) {
      // `vite preview` has no module runner, so spin up a headless one just for functions/.
      // `noDiscovery` matters: without it this server crawls index.html looking for dependencies
      // to pre-bundle, which it cannot resolve because it is not loading the app's config.
      // Nothing under functions/ needs pre-bundling anyway - it is all source.
      loader = await createServer({
        configFile: false,
        server: { middlewareMode: true, hmr: false },
        appType: 'custom',
        optimizeDeps: { noDiscovery: true, include: [] },
        logLevel: 'warn',
      });
      ownLoader = true;
      server.middlewares.use((req, res, next) => void handle(req, res, next));
    },
    async closeBundle() {
      if (ownLoader && loader) {
        await loader.close();
        loader = null;
        ownLoader = false;
      }
    },
  };
}
