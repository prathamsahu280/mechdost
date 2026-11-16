import type { Keyring } from '@mechdost/db/crypto';
import type { Tx, UserRecord } from '@mechdost/db/repo';
import type { Grant } from '@mechdost/shared/rbac';
import type { AssistantProvider } from './assistant/provider';
import type { PasswordAuthority } from './auth/password-authority';
import type { TokenVerifier, VerifiedToken } from './auth/token-verifier';
import type { TurnstileVerifier } from './auth/turnstile';
import type { Config } from './config';
import type { SentryIssuesClient } from './monitoring/sentry-issues';
import type { PhotoStorage } from './photos/storage';
import type { RazorpayGateway } from './payments/razorpay';
import type { RateLimiter } from './rate-limit/limiter';
import type { Revalidator } from './revalidate';

/** Everything the app needs from the outside world — injected so tests use PGlite and fakes. */
export interface AppDeps {
  config: Config;
  db: Tx;
  verifier: TokenVerifier;
  rateLimiter: RateLimiter;
  /** LLM provider for /v1/assistant (null when no key is configured → 503, the web falls back to static answers). */
  assistant?: AssistantProvider | null;
  /** Field-encryption keyring (delivery codes); null when not configured (development only). */
  keyring?: Keyring | null;
  /** Password checks + custom tokens (spec 01); null when not configured → sign-in answers 503. */
  passwordAuth?: PasswordAuthority | null;
  /** Bot check on sign-in; null when not configured → sign-in answers 503 (fails closed). */
  turnstile?: TurnstileVerifier | null;
  /** Razorpay gateway; null when not configured → online payment answers PAYMENT_METHOD_UNAVAILABLE. */
  razorpay?: RazorpayGateway | null;
  /** Private Storage for job photos; null when not configured → photo routes answer 503 PHOTOS_UNAVAILABLE. */
  photoStorage?: PhotoStorage | null;
  /** Read-only Sentry issues for Admin → Errors; null when no read token is configured → "not connected". */
  sentryIssues?: SentryIssuesClient | null;
  /** Refreshes the website's cache by tag after a publish; absent = the configured one (tests inject a spy). */
  revalidate?: Revalidator;
}

export interface AuthContext {
  user: UserRecord;
  grants: Grant[];
  /** Seconds since epoch when the user last proved possession of their phone (token auth_time). */
  authTime: number;
  /** Staff grants left out because this session was not made by both staff steps (or is older than a day). */
  staffWithheld: Grant[];
}

export interface AppEnv {
  Variables: {
    requestId: string;
    clientIp: string;
    auth: AuthContext;
    /** The bearer token the global API limit already verified (no revocation check); `authenticate` reuses it. */
    verifiedToken?: { token: string; identity: VerifiedToken };
  };
}
