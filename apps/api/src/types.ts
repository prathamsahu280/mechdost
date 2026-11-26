import type { Keyring } from '@mechdost/db/crypto';
import type { Tx, UserRecord } from '@mechdost/db/repo';
import type { Grant } from '@mechdost/shared/rbac';
import type { MemberView } from '@mechdost/shared/ustaad/dto/members';
import type { AssistantProvider } from './assistant/provider';
import type { EmailActionLinks } from './auth/email-actions';
import type { PasswordAuthority } from './auth/password-authority';
import type { TokenVerifier, VerifiedToken } from './auth/token-verifier';
import type { TurnstileVerifier } from './auth/turnstile';
import type { Config } from './config';
import type { SentryIssuesClient } from './monitoring/sentry-issues';
import type { PhotoStorage } from './photos/storage';
import type { PhotoByteCache } from './photos/byte-cache';
import type { RazorpayGateway } from './payments/razorpay';
import type { RateLimiter } from './rate-limit/limiter';
import type { Revalidator } from './revalidate';
import type { CorrectionCache } from './ustaad/correction/cache';
import type { SmartCorrectionEngine } from './ustaad/correction/engine';
import type { FeedSnapshotStore } from './ustaad/feed/snapshot';
import type { PreviewDeps } from './ustaad/link-preview';
import type { MediaHost } from './ustaad/media/host';
import type { ImageSafetyClassifier } from './ustaad/safety/classifier';

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
  /** One-time codes for the reset and verification emails we send ourselves (decision 2026-11-24); null → those routes answer 503. */
  emailActions?: EmailActionLinks | null;
  /** Bot check on sign-in; null when not configured → sign-in answers 503 (fails closed). */
  turnstile?: TurnstileVerifier | null;
  /** Razorpay gateway; null when not configured → online payment answers PAYMENT_METHOD_UNAVAILABLE. */
  razorpay?: RazorpayGateway | null;
  /** Private Storage for job photos; null when not configured → photo routes answer 503 PHOTOS_UNAVAILABLE. */
  photoStorage?: PhotoStorage | null;
  /** In-process cache of public product-photo bytes (saves Storage egress); absent = no caching. */
  photoCache?: PhotoByteCache | null;
  /** Read-only Sentry issues for Admin → Errors; null when no read token is configured → "not connected". */
  sentryIssues?: SentryIssuesClient | null;
  /** Refreshes the website's cache by tag after a publish; absent = the configured one (tests inject a spy). */
  revalidate?: Revalidator;
  /** Ustaad smart-correction LLM (spec 23 § 11); null/absent = the word list only. */
  smartCorrection?: SmartCorrectionEngine | null;
  /** Cache for LLM corrections (masked text only); absent = a per-instance memory cache. */
  correctionCache?: CorrectionCache;
  /** Ustaad Network media store (R2 or Supabase, spec 23 § 10); null → media routes answer 503 MEDIA_UNAVAILABLE. */
  mediaHost?: MediaHost | null;
  /** Ustaad image-safety classifier (spec 23 § 10 step 4, Q-U6); null/absent = none (pre-moderation applies). */
  safetyClassifier?: ImageSafetyClassifier | null;
  /** For you snapshots (spec 23 § 9.5); absent = a per-instance memory store. */
  feedSnapshots?: FeedSnapshotStore;
  /** SSRF-safe link-preview fetcher (spec 23 § 10a); null/absent = no previews (tests, development). */
  linkPreview?: PreviewDeps | null;
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
    /** The Ustaad member making the request (set by `requireUstaadMember`, spec 23). */
    ustaadMember?: MemberView;
  };
}
