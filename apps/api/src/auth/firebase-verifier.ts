import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { TokenError, type TokenVerifier, type VerifiedToken } from './token-verifier';

/** Phone OTP is the only sign-in method (decision 2026-10-31); anonymous/custom/password tokens are refused. */
const ALLOWED_PROVIDERS = new Set(['phone']);

const ERROR_CODES: Record<string, TokenError['code']> = {
  'auth/id-token-expired': 'TOKEN_EXPIRED',
  'auth/id-token-revoked': 'TOKEN_REVOKED',
  'auth/user-disabled': 'USER_DISABLED',
};

function errorCode(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string')
    return err.code;
  return undefined;
}

/**
 * Verifies Firebase ID tokens with firebase-admin (signature, `aud` = project, `iss`, expiry, optional
 * revocation). Credentials: Cloud Run service account (ADC) in production; `FIREBASE_AUTH_EMULATOR_HOST`
 * locally, which firebase-admin reads itself. Never use hono/jwt for Firebase tokens (key rotation, aud).
 */
export function createFirebaseVerifier(projectId: string): TokenVerifier {
  const app = getApps()[0] ?? initializeApp({ projectId });
  const auth = getAuth(app);

  return {
    async verify(token, { checkRevoked }): Promise<VerifiedToken> {
      try {
        const decoded = await auth.verifyIdToken(token, checkRevoked);
        const provider = decoded.firebase.sign_in_provider;
        if (!ALLOWED_PROVIDERS.has(provider)) throw new TokenError('PROVIDER_NOT_ALLOWED');
        return {
          firebaseUid: decoded.uid,
          phone: decoded.phone_number ?? null,
          email: decoded.email ?? null,
          emailVerified: decoded.email_verified === true,
          authTime: decoded.auth_time,
          signInProvider: provider,
        };
      } catch (err) {
        if (err instanceof TokenError) throw err;
        throw new TokenError(ERROR_CODES[errorCode(err) ?? ''] ?? 'TOKEN_INVALID');
      }
    },
  };
}
