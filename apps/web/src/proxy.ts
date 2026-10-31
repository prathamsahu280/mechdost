import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/** Locale negotiation only. Never an auth boundary (Next middleware bypass class, security research #4). */
export default createMiddleware(routing);

export const config = {
  // Everything except API routes, Next internals, Vercel internals and files with an extension.
  matcher: '/((?!api|_next|_vercel|.*\\..*).*)',
};
