import { STAFF_2FA_CLAIM } from '@mechdost/shared/auth';
import { getAuth } from 'firebase-admin/auth';
import { firebaseAdminApp } from './firebase-app';
import { TokenError, type TokenVerifier, type VerifiedToken } from './token-verifier';

/**
 * Sign-in methods (decision 2026-11-01): `phone` = OTP (sign-up, staff second step, password reset by phone);
 * `custom` = password sign-in, whose token is minted only by our own `POST /v1/auth/password` after it checked
 * the password with rate limits and lockout (spec 01). Direct Firebase `password` and `anonymous` tokens are
 * refused so every password attempt goes through those limits. Custom tokens never create accounts
 * (`ensureUser` requires a verified phone for that).
 */
const ALLOWED_PROVIDERS = new Set(['phone', 'custom']);

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
export function createFirebaseVerifier(projectId: string, keyFile: string | null = null): TokenVerifier {
  const app = firebaseAdminApp({ projectId, keyFile });
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
          staff2fa: provider === 'custom' && decoded[STAFF_2FA_CLAIM] === true,
        };
      } catch (err) {
        if (err instanceof TokenError) throw err;
        throw new TokenError(ERROR_CODES[errorCode(err) ?? ''] ?? 'TOKEN_INVALID');
      }
    },
  };
}
