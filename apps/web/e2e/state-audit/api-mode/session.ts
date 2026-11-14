/**
 * Signed-in session for the API-mode audit (Q106, 2026-11-15) without a Firebase emulator and without any test switch
 * in production code.
 *
 * The real-mode web keeps two things after a sign-in: the browser session of the demo store (`mechdost-demo-session`,
 * seeded by `harness.ts seedFor`, which is what the portal gates read) and Firebase's own persisted user, from which
 * `currentIdToken()` gets the bearer token for every `/v1` call. This file writes the second one the way Firebase's
 * SDK stores it (localStorage `firebase:authUser:<apiKey>:[DEFAULT]`; the SDK also reads that store when IndexedDB is
 * empty) with an unsigned, far-future token, and answers the SDK's two network calls (`accounts:lookup`, the token
 * refresh) with `page.route`. The API ignores the token here because the API is mocked too (`mock-api.ts`).
 *
 * Why it cannot leak into production: nothing under `src/` knows about it. The audit builds its own copy of the web
 * (`scripts/state-audit-api-build.mjs`, `NEXT_DIST_DIR=.next-api`) with a fake Firebase key and an API origin of
 * `127.0.0.1:4100`, neither of which the production images contain, and the files live under `e2e/`, which the
 * Docker image never copies.
 */
import type { Page } from '@playwright/test';

/** Public values baked into the audit build (`state-audit-api-build.mjs`); fake on purpose. */
export const AUDIT_FIREBASE = {
  apiKey: 'audit-fake-api-key',
  authDomain: 'audit.invalid',
  projectId: 'demo-audit',
  appId: '1:000000000000:web:audit',
} as const;

/** Where the mocked API answers (the audit build's `NEXT_PUBLIC_API_URL`). */
export const AUDIT_API_ORIGIN = 'http://127.0.0.1:4100';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

/** An unsigned JWT-shaped token; the SDK only reads its expiry, and the mocked API never verifies it. */
export function fakeIdToken(uid: string, now: number): string {
  const iat = Math.floor(now / 1000);
  return [
    b64({ alg: 'none', typ: 'JWT' }),
    b64({
      iss: 'https://securetoken.google.com/demo-audit',
      aud: 'demo-audit',
      sub: uid,
      user_id: uid,
      iat,
      exp: iat + 3_650 * 86_400,
    }),
    'audit',
  ].join('.');
}

/** The localStorage entry that makes Firebase's SDK start with this user signed in. */
export function persistedUser(uid: string, phone: string, now: number): Record<string, string> {
  const token = fakeIdToken(uid, now);
  const user = {
    uid,
    email: `${uid}@audit.invalid`,
    emailVerified: true,
    phoneNumber: `+91${phone}`,
    isAnonymous: false,
    providerData: [],
    stsTokenManager: {
      refreshToken: 'audit-refresh',
      accessToken: token,
      expirationTime: now + 3_650 * 86_400_000,
    },
    createdAt: String(now - 86_400_000),
    lastLoginAt: String(now),
    apiKey: AUDIT_FIREBASE.apiKey,
    appName: '[DEFAULT]',
  };
  return { [`firebase:authUser:${AUDIT_FIREBASE.apiKey}:[DEFAULT]`]: JSON.stringify(user) };
}

/** Answers Firebase's two token calls. Register after the harness's "abort every other origin" route. */
export async function mockFirebase(page: Page, uid: string, phone: string, now: number): Promise<void> {
  const token = fakeIdToken(uid, now);
  await page.route('https://identitytoolkit.googleapis.com/**', (route) =>
    route.fulfill({
      json: {
        kind: 'identitytoolkit#GetAccountInfoResponse',
        users: [
          {
            localId: uid,
            email: `${uid}@audit.invalid`,
            emailVerified: true,
            phoneNumber: `+91${phone}`,
            providerUserInfo: [],
            createdAt: String(now - 86_400_000),
            lastLoginAt: String(now),
          },
        ],
      },
    }),
  );
  await page.route('https://securetoken.googleapis.com/**', (route) =>
    route.fulfill({
      json: {
        access_token: token,
        id_token: token,
        refresh_token: 'audit-refresh',
        expires_in: '3600',
        token_type: 'Bearer',
        user_id: uid,
        project_id: AUDIT_FIREBASE.projectId,
      },
    }),
  );
}
