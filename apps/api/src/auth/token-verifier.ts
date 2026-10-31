import type { VerifiedIdentity } from '@mechdost/db/repo';

/** A verified Firebase ID token, reduced to what the API uses. */
export interface VerifiedToken extends VerifiedIdentity {
  /** `auth_time`: when the user last signed in (seconds). Used for recent-auth checks on sensitive actions. */
  authTime: number;
  signInProvider: string;
}

export interface VerifyOptions {
  /** Also check the token has not been revoked (one network call) — money, admin and partner actions. */
  checkRevoked: boolean;
}

/** Injected so tests never call Firebase (skill firebase-phone-auth-rbac). */
export interface TokenVerifier {
  verify(token: string, opts: VerifyOptions): Promise<VerifiedToken>;
}

export type TokenErrorCode =
  'TOKEN_INVALID' | 'TOKEN_EXPIRED' | 'TOKEN_REVOKED' | 'USER_DISABLED' | 'PROVIDER_NOT_ALLOWED';

export class TokenError extends Error {
  constructor(readonly code: TokenErrorCode) {
    super(code);
    this.name = 'TokenError';
  }
}
