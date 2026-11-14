import { getAuth } from 'firebase-admin/auth';
import { firebaseAdminApp } from './firebase-app';

/**
 * Where passwords are checked and sessions minted (decision 2026-11-01): Firebase Auth holds the password
 * (scrypt); we never see or store a hash. Injected so tests never call Firebase.
 */
export interface PasswordAuthority {
  /** The Firebase uid when `password` is right for `email`'s password credential, else null. Throws when
   *  Firebase cannot answer (network, quota) — the caller answers 503 and does not count a failure. */
  check(email: string, password: string): Promise<string | null>;
  /** The email of the Firebase account `uid` (its password credential), or null. */
  emailOf(uid: string): Promise<string | null>;
  /** A Firebase custom token for `uid` (the client calls `signInWithCustomToken`). */
  customToken(uid: string, claims?: Record<string, boolean>): Promise<string>;
  /**
   * End every session of `uid` (Firebase `revokeRefreshTokens`): used when a staff role is removed, so the person
   * signs in again and no old session lingers. Optional so a deployment without it still works (the session cache
   * expires within a minute either way).
   */
  revokeSessions?(uid: string): Promise<void>;
}

/** Firebase answers these for a wrong password or an account without one: all mean "no". */
const NO = new Set([
  'INVALID_LOGIN_CREDENTIALS',
  'EMAIL_NOT_FOUND',
  'INVALID_PASSWORD',
  'INVALID_EMAIL',
  'MISSING_PASSWORD',
  'USER_DISABLED',
]);

/**
 * Identity Toolkit `accounts:signInWithPassword` with the project's web API key, server side only (the browser
 * never signs in with a password directly: the API accepts only phone and custom tokens). Custom tokens are
 * signed by the Admin SDK (`firebase-app.ts`: key file locally, IAM on Cloud Run). `emulatorHost` points both
 * at the Auth Emulator.
 */
export function createFirebasePasswordAuthority(opts: {
  projectId: string;
  apiKey: string;
  keyFile?: string | null;
  emulatorHost?: string;
}): PasswordAuthority {
  const app = firebaseAdminApp({ projectId: opts.projectId, keyFile: opts.keyFile ?? null });
  const auth = getAuth(app);
  const base = opts.emulatorHost
    ? `http://${opts.emulatorHost}/identitytoolkit.googleapis.com`
    : 'https://identitytoolkit.googleapis.com';
  return {
    async check(email, password) {
      const res = await fetch(
        `${base}/v1/accounts:signInWithPassword?key=${encodeURIComponent(opts.apiKey)}`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password, returnSecureToken: false }),
          signal: AbortSignal.timeout(5000),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { localId?: string; error?: { message?: string } };
      if (res.ok && typeof body.localId === 'string') return body.localId;
      const reason = (body.error?.message ?? '').split(' ')[0] ?? '';
      if (res.status === 400 && NO.has(reason)) return null;
      throw new Error(`password check failed: ${String(res.status)} ${reason}`);
    },
    async emailOf(uid) {
      try {
        return (await auth.getUser(uid)).email ?? null;
      } catch (err) {
        // A profile whose Firebase account is gone: the generic "no match", not "unavailable".
        if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'auth/user-not-found')
          return null;
        throw err;
      }
    },
    customToken(uid, claims) {
      return auth.createCustomToken(uid, claims);
    },
    revokeSessions(uid) {
      return auth.revokeRefreshTokens(uid);
    },
  };
}
