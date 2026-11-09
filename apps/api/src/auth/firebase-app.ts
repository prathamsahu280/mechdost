import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';

/**
 * The one Firebase Admin app of this process (token checks, custom tokens, Realtime Database).
 *
 * - Local development: the service-account key file (`GOOGLE_APPLICATION_CREDENTIALS`, outside the repo) is
 *   passed explicitly, so custom tokens are signed locally. Through plain application-default credentials
 *   firebase-admin signs with the IAM Credentials API instead, which a fresh project has not enabled.
 * - Cloud Run: no key file (config refuses one in production); the runtime service account signs custom tokens
 *   through IAM (needs `roles/iam.serviceAccountTokenCreator` on itself and the IAM Credentials API enabled —
 *   runbook `docs/runbooks/firebase.md`).
 */
export function firebaseAdminApp(opts: {
  projectId: string;
  keyFile?: string | null;
  databaseURL?: string;
}): App {
  const existing = getApps()[0];
  if (existing) return existing;
  return initializeApp({
    projectId: opts.projectId,
    ...(opts.keyFile ? { credential: cert(opts.keyFile) } : {}),
    ...(opts.databaseURL ? { databaseURL: opts.databaseURL } : {}),
  });
}
