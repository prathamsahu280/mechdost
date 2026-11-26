import createMiddleware from 'next-intl/middleware';
import { NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { cspFromEnv, isLoginPath } from './lib/csp';

const intl = createMiddleware(routing);

/**
 * Locale negotiation, and in real sign-in mode a per-request CSP nonce for `/login` (decisions 2026-11-09): the
 * nonce goes in the request header Next reads while rendering that page (next-intl forwards request headers) and
 * replaces the site-wide policy in the response. Never an auth boundary (Next middleware bypass class, security
 * research #4).
 */
export default function proxy(request: NextRequest) {
  if (process.env.NEXT_PUBLIC_AUTH_MODE !== 'firebase' || !isLoginPath(request.nextUrl.pathname))
    return intl(request);
  const nonce = btoa(crypto.randomUUID());
  const policy = cspFromEnv(nonce);
  const headers = new Headers(request.headers);
  headers.set('content-security-policy', policy);
  const response = intl(new NextRequest(request, { headers }));
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  // Everything except API routes, Next internals, Vercel internals and files with an extension; plus the Ustaad share
  // teaser, whose token has a dot (`{22}.{22}`) and would otherwise look like a file and skip the locale rewrite
  // (404, found by e2e 2026-11-26).
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)', '/ustaad/s/:token', '/hi/ustaad/s/:token'],
};
