import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Security headers for every page (docs/research/security-vulnerabilities.md #21). A nonce-based CSP is added
 * with the first third-party script (Turnstile/Razorpay/PostHog) — today the site loads first-party code only.
 */
const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self), payment=(self)' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'" },
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
    return Promise.resolve([{ source: '/:path*', headers: securityHeaders }]);
  },
};

// Message keys are type-checked via AppConfig (src/global.ts). Literal value typing (createMessagesDeclaration)
// is not used: it types values as the English text, which the Hindi file can never match. Placeholder parity
// between languages is enforced by packages/shared/test/i18n.test.ts instead.
const withNextIntl = createNextIntlPlugin();

export default withNextIntl(nextConfig);
