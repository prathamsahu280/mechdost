import { createHash } from 'node:crypto';
import { SITE_LAYOUT_SCRIPT } from './site-layout';
import { THEME_INIT_SCRIPT } from './theme';

/**
 * Content-Security-Policy for every page (security research #21, ruling 2026-11-09). Static pages stay static, so
 * this is an **allow-list** policy, not a nonce one (Next 16: nonces force every page to render per request, docs
 * `content-security-policy.md`): scripts, connections, frames and workers may come only from this site and the
 * few origins below; plugins, `<base>` hijacks, foreign form targets and framing are refused. `'unsafe-inline'`
 * stays for scripts and styles because Next's prerendered pages carry inline bootstrap scripts and inlined CSS.
 * The third-party origins of real sign-in (Turnstile, reCAPTCHA, Firebase Auth) are added only in firebase mode.
 */
export interface CspInput {
  dev: boolean;
  authMode: 'firebase' | 'demo';
  /** `NEXT_PUBLIC_API_URL`, when the web talks to the API. */
  apiUrl?: string | undefined;
  /** `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN` (frames for Firebase Auth helpers). */
  firebaseAuthDomain?: string | undefined;
  /** `NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST` (local tests only). */
  authEmulatorHost?: string | undefined;
  /**
   * Per-request nonce (the `/login` page in real mode, added by the proxy): scripts then need the nonce or must be
   * loaded by a script that had it (`'strict-dynamic'`), so injected inline script no longer runs there.
   */
  nonce?: string | undefined;
}

/** Map styles, vector tiles, glyphs, sprites (OpenFreeMap) and satellite tiles (Esri), fetched by MapLibre. */
const MAP_ORIGINS = ['https://tiles.openfreemap.org', 'https://server.arcgisonline.com'];
const TURNSTILE = 'https://challenges.cloudflare.com';
const RECAPTCHA_SCRIPTS = ['https://www.google.com/recaptcha/', 'https://www.gstatic.com/recaptcha/'];
const RECAPTCHA_FRAMES = ['https://www.google.com/recaptcha/', 'https://recaptcha.google.com/recaptcha/'];
const FIREBASE_AUTH_APIS = ['https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com'];
/**
 * The root layout's two fixed inline scripts (theme before first paint, admin home layout). The shared layout
 * cannot read a nonce without making every page dynamic, so under a nonce policy they are allowed by hash.
 */
export const INLINE_SCRIPT_HASHES = [THEME_INIT_SCRIPT, SITE_LAYOUT_SCRIPT].map(
  (source) => `'sha256-${createHash('sha256').update(source).digest('base64')}'`,
);

// Razorpay Standard Checkout (pay online, real-sign-in builds): checkout.js, its iframe and its API.
const RAZORPAY_SCRIPTS = ['https://checkout.razorpay.com'];
const RAZORPAY_FRAMES = ['https://api.razorpay.com', 'https://checkout.razorpay.com'];
const RAZORPAY_CONNECT = ['https://api.razorpay.com', 'https://lumberjack.razorpay.com'];
const RAZORPAY_IMAGES = ['https://cdn.razorpay.com'];

const origin = (url: string | undefined) => {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
};

export function contentSecurityPolicy(input: CspInput): string {
  const real = input.authMode === 'firebase';
  const api = origin(input.apiUrl);
  const authDomain = real && input.firebaseAuthDomain ? origin(`https://${input.firebaseAuthDomain}`) : null;
  const emulator = real && input.authEmulatorHost ? `http://${input.authEmulatorHost}` : null;

  // With a nonce, CSP2+ browsers ignore 'unsafe-inline' (kept only as a CSP1 fallback) and, with
  // 'strict-dynamic', the host list too; scripts loaded by nonced scripts (Turnstile, reCAPTCHA) still run.
  const script = input.nonce
    ? ["'self'", `'nonce-${input.nonce}'`, "'strict-dynamic'", ...INLINE_SCRIPT_HASHES, "'unsafe-inline'"]
    : ["'self'", "'unsafe-inline'"];
  if (input.dev) script.push("'unsafe-eval'");
  if (real) script.push(TURNSTILE, ...RECAPTCHA_SCRIPTS, ...RAZORPAY_SCRIPTS);

  const connect = ["'self'", ...MAP_ORIGINS];
  if (api) connect.push(api);
  if (real) connect.push(...FIREBASE_AUTH_APIS, TURNSTILE, ...RAZORPAY_CONNECT);
  if (emulator) connect.push(emulator);
  if (input.dev) connect.push('ws:');

  const frame = real
    ? [TURNSTILE, ...RECAPTCHA_FRAMES, ...RAZORPAY_FRAMES, ...(authDomain ? [authDomain] : [])]
    : ["'none'"];

  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', script],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', ...MAP_ORIGINS, ...(real ? RAZORPAY_IMAGES : [])]],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connect],
    ['worker-src', ["'self'", 'blob:']],
    ['frame-src', frame],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
  ];
  return directives.map(([name, values]) => `${name} ${values.join(' ')}`).join('; ');
}

/** The policy for this build (env values are fixed at build time); `nonce` only for `/login` in real mode. */
export function cspFromEnv(nonce?: string): string {
  return contentSecurityPolicy({
    dev: process.env.NODE_ENV === 'development',
    authMode: process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase' ? 'firebase' : 'demo',
    apiUrl: process.env.NEXT_PUBLIC_API_URL,
    firebaseAuthDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    authEmulatorHost: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
    nonce,
  });
}

/** `/login` and `/hi/login`: the one page that renders per request with a nonce in real mode. */
export const isLoginPath = (pathname: string) => /^\/(?:hi\/)?login\/?$/.test(pathname);
