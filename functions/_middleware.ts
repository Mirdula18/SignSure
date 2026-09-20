import type { Env } from './lib/env';
import { errorResponse } from './lib/http';
import { LIMITS } from '../shared/limits';

/**
 * Runs in front of every `/api/*` request.
 *
 * Four jobs, in the order they become cheap to do:
 * 1. Reject anything larger than the payload cap before a route reads the body.
 * 2. Reject cross-origin writes, so the API cannot be driven from someone else's page.
 * 3. Turn an unhandled throw into the same JSON envelope as every other error, never a stack.
 * 4. Stamp security headers on the response, including `no-store`.
 *
 * Static assets get their headers from `public/_headers`; this covers the API, which Cloudflare
 * serves through Functions rather than through that file.
 */

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // `public/_headers` covers static assets; an /api/* response is served by this Function and
  // would otherwise be the one path on the site that never carries HSTS.
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()',
  'Cache-Control': 'no-store',
};

const WRITE_METHODS: ReadonlySet<string> = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Whether the request came from a page we serve.
 *
 * Checked instead of a CSRF token because the API is called with a bearer token rather than a
 * cookie, so a cross-site request cannot borrow the user's credentials anyway; the origin check
 * simply stops the proxy being embedded in someone else's site. Requests with no `Origin` at
 * all (curl, a health probe) are allowed through: they carry no ambient authority to abuse.
 */
function originAllowed(request: Request, env: Env): boolean {
  const origin = request.headers.get('origin');
  if (origin === null) return true;

  const allowed = env.ALLOWED_ORIGIN?.trim();
  if (allowed === undefined || allowed.length === 0) {
    // Unconfigured: fall back to same-origin, so a missing var cannot open the API up.
    return origin === new URL(request.url).origin;
  }
  return origin === allowed;
}

function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/**
 * Declared body size, when the client states one. Chunked uploads are caught by the route.
 *
 * Only a bare digit string counts, which is all RFC 9110 permits. `Number.parseInt` on its own
 * would read "1e9" as 1 and "-1" as -1, both of which would sail past the cap.
 */
function declaredBodyBytes(request: Request): number | null {
  const header = request.headers.get('content-length');
  if (header === null || !/^\d+$/.test(header.trim())) return null;
  return Number.parseInt(header.trim(), 10);
}

export const onRequest: PagesFunction<Env> = async (context) => {
  const { request } = context;

  if (!new URL(request.url).pathname.startsWith('/api/')) {
    return context.next();
  }

  const size = declaredBodyBytes(request);
  if (size !== null && size > LIMITS.maxRequestBytes) {
    return withSecurityHeaders(errorResponse('TOO_LARGE'));
  }

  if (WRITE_METHODS.has(request.method) && !originAllowed(request, context.env)) {
    return withSecurityHeaders(errorResponse('UNAUTHORIZED'));
  }

  try {
    return withSecurityHeaders(await context.next());
  } catch {
    // Deliberately swallows the error rather than logging it: a stack trace from a route that
    // was handling clause text could contain that text (see CLAUDE.md rule 7).
    return withSecurityHeaders(errorResponse('INTERNAL'));
  }
};
