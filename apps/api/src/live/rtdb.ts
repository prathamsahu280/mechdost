import { getDatabaseWithUrl } from 'firebase-admin/database';
import { firebaseAdminApp } from '../auth/firebase-app';
import { inboxRemovals, inboxUpdates, type LivePublisher } from './publisher';

/**
 * Firebase Realtime Database transport (decision 2026-11-01). The worker writes with the Admin SDK (service
 * account via Application Default Credentials on Cloud Run); browsers and the app only *read* their own inbox,
 * enforced by `database.rules.json` (`auth.uid === $uid`, no client writes). One multi-path update per batch.
 */
export function createRtdbPublisher(opts: {
  projectId: string;
  databaseUrl: string;
  keyFile?: string | null;
}): LivePublisher {
  const app = firebaseAdminApp({
    projectId: opts.projectId,
    keyFile: opts.keyFile ?? null,
    databaseURL: opts.databaseUrl,
  });
  const db = getDatabaseWithUrl(opts.databaseUrl, app);
  return {
    name: 'rtdb',
    async publish(batch) {
      const updates = inboxUpdates(batch);
      if (Object.keys(updates).length === 0) return;
      await db.ref().update(updates);
    },
    async forget(targets) {
      const removals = inboxRemovals(targets);
      if (Object.keys(removals).length === 0) return;
      await db.ref().update(removals);
    },
  };
}
