/**
 * Which sign-in the web uses (Q69, default meanwhile): `firebase` = real accounts on Firebase + the API (local
 * development and the launch), `demo` = the browser-only role logins with code 123456 (partner demos; also the
 * fallback when unset, so a deployed demo never needs keys). Inlined at build time.
 */
export const AUTH_MODE: 'firebase' | 'demo' =
  process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase' ? 'firebase' : 'demo';
