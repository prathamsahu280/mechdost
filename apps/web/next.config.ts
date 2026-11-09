import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { contentSecurityPolicy } from './src/lib/csp';

/**
 * Security headers for every page (docs/research/security-vulnerabilities.md #21). The CSP is an allow-list built
 * by `src/lib/csp.ts` from the build's settings (ruling 2026-11-09: nonces would make every page dynamic); real
 * sign-in mode adds Turnstile, reCAPTCHA and Firebase Auth.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
  {
    key: 'Content-Security-Policy',
    value: contentSecurityPolicy({
      dev: process.env.NODE_ENV === 'development',
      authMode: process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase' ? 'firebase' : 'demo',
      apiUrl: process.env.NEXT_PUBLIC_API_URL,
      firebaseAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      authEmulatorHost: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    }),
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // CSS is ~7 KB gzipped: inlining removes the render-blocking request (≈0.5 s LCP on slow 4G, trace 2026-11-01).
  experimental: { inlineCss: true },
  transpilePackages: ['@mechdost/shared', '@mechdost/ui'],
  images: {
    formats: ['image/avif', 'image/webp'],
    // Remote hosts are added explicitly (Supabase Storage) when product photos arrive; never wildcards.
    remotePatterns: [],
    dangerouslyAllowSVG: false,
  },
  headers() {
    return Promise.resolve([
      { source: '/:path*', headers: securityHeaders },
      // Versioned file names (scripts/copy-map-worker.mjs), so they can be cached forever.
      {
        source: '/vendor/:file*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
    ]);
  },
};

// Message keys are type-checked via AppConfig (src/global.ts). Literal value typing (createMessagesDeclaration)
// is not used: it types values as the English text, which the Hindi file can never match. Placeholder parity
// between languages is enforced by packages/shared/test/i18n.test.ts instead.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
