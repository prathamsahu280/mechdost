import type { Tx, UserRecord } from '@mechdost/db/repo';
import type { Grant } from '@mechdost/shared/rbac';
import type { TokenVerifier } from './auth/token-verifier';
import type { Config } from './config';
import type { RateLimiter } from './rate-limit/limiter';

/** Everything the app needs from the outside world — injected so tests use PGlite and fakes. */
export interface AppDeps {
  config: Config;
  db: Tx;
  verifier: TokenVerifier;
  rateLimiter: RateLimiter;
}

export interface AuthContext {
  user: UserRecord;
  grants: Grant[];
  /** Seconds since epoch when the user last proved possession of their phone (token auth_time). */
  authTime: number;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    clientIp: string;
    auth: AuthContext;
  };
}
