import { fileURLToPath } from 'node:url';
import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { cspFromEnv } from './src/lib/csp';

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
    value: cspFromEnv(),
  },
];

const nextConfig: NextConfig = {
  // Docker image (docs/runbooks/deploy.md): a self-contained server with only the files it needs.
  output: 'standalone',
  // The monorepo root, so workspace packages are traced into the standalone output.
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  poweredByHeader: false,
  // Sentry's Node SDK stays a runtime dependency of the server, not bundled (instrumentation.ts, decision 2026-11-14).
  serverExternalPackages: ['@sentry/node'],
  // Browser source maps only for the Docker build that uploads them to Sentry; the same step deletes them, so they
  // are never served (apps/web/Dockerfile, docs/runbooks/monitoring.md).
  productionBrowserSourceMaps: process.env.SENTRY_SOURCEMAPS === '1',
  reactStrictMode: true,
  // The two build switches are always defined, so they are inlined as constants and the code for the other mode is
  // dropped from the bundle (an unset NEXT_PUBLIC_ variable is left as a runtime lookup). Unset means demo, as
  // `lib/data-mode.ts` and `lib/auth/mode.ts` already read it.
  env: {
    NEXT_PUBLIC_DATA_MODE: process.env.NEXT_PUBLIC_DATA_MODE === 'api' ? 'api' : 'demo',
    NEXT_PUBLIC_AUTH_MODE: process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase' ? 'firebase' : 'demo',
  },
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
