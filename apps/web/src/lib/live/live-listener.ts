import { getApps } from '@firebase/app';
import {
  getDatabase,
  goOffline,
  goOnline,
  off,
  onChildAdded,
  onChildChanged,
  ref,
  type Database,
  type DataSnapshot,
} from '@firebase/database';
import { LIVE_KINDS, newPings, parseLivePing, type LiveKind } from '@mechdost/shared/live';

/**
 * The one Realtime Database subscription of this tab (spec 10 "Live updates"). **Heavy: load it only through a dynamic import
 * from `live-hub.ts`** (it carries the database SDK, about 30 KB gz; guard test
 * `test/live-lazy.test.ts`).
 *
 * Reads only `inbox/<uid>` (the rules allow nothing else); each child is a thin ping `{e,k,id,v,at}` that
 * `parseLivePing` validates (exact keys) and `newPings` version-gates, so duplicates and old pings are dropped. The
 * connection is open only while the tab is visible and is closed when it is hidden (no idle sockets, no battery);
 * coming back opens it again and asks for one catch-up of every kind, because pings may have arrived meanwhile. A uid
 * change (another account signed in) re-points the subscription and forgets the version gate. Failures (permission
 * denied, no network, database not reachable) end the live connection quietly: the polling in each consumer is
 * always running and carries on.
 */
export interface ConnectOptions {
  locale: string;
  onKinds: (kinds: readonly LiveKind[]) => void;
}

export function connectLive({ locale, onKinds }: ConnectOptions): () => void {
  let db: Database | null = null;
  let uid: string | null = null;
  let attached: { uid: string; stop: () => void } | null = null;
  let seen = new Map<string, number>();
  let stopped = false;
  const isStopped = () => stopped;
  let unwatch: (() => void) | undefined;

  /** A callback is honoured only for the account it was attached for, while connected and visible. */
  const onSnapshotFor = (owner: string) => (snap: DataSnapshot) => {
    if (stopped || uid !== owner || document.visibilityState !== 'visible') return;
    const ping = parseLivePing(snap.val());
    if (!ping) return;
    const fresh = newPings(seen, [ping]);
    if (fresh.length > 0) onKinds(fresh.map((p) => p.k));
  };

  const detach = () => {
    attached?.stop();
    attached = null;
  };

  const attach = () => {
    if (stopped || !db || !uid || document.visibilityState !== 'visible' || attached?.uid === uid) return;
    detach();
    const inbox = ref(db, `inbox/${uid}`);
    // Permission denied or the connection is gone for good: stop quietly, the polling stays.
    const fail = () => {
      detach();
    };
    const onSnapshot = onSnapshotFor(uid);
    onChildAdded(inbox, onSnapshot, fail);
    onChildChanged(inbox, onSnapshot, fail);
    attached = {
      uid,
      stop: () => {
        off(inbox);
      },
    };
  };

  const onVisibility = () => {
    if (stopped || !db) return;
    if (document.visibilityState === 'visible') {
      goOnline(db);
      attach();
      onKinds(LIVE_KINDS); // catch-up for whatever arrived while hidden
    } else {
      detach();
      goOffline(db);
    }
  };

  void (async () => {
    try {
      const url = process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL;
      const client = await import('../auth/firebase-client');
      if (isStopped() || !url) return;
      await client.currentUid(locale); // initialises the Firebase app and waits for the saved session
      const app = getApps()[0];
      if (isStopped() || !app) return;
      db = getDatabase(app, url);
      unwatch = client.watchUid(locale, (next) => {
        if (next !== uid) {
          detach();
          seen = new Map();
          uid = next;
        }
        attach();
      });
      document.addEventListener('visibilitychange', onVisibility);
      if (document.visibilityState !== 'visible') goOffline(db);
    } catch {
      // Not available here (blocked, offline): the polling carries on.
    }
  })();

  return () => {
    stopped = true;
    unwatch?.();
    detach();
    document.removeEventListener('visibilitychange', onVisibility);
    if (db) goOffline(db);
    seen = new Map();
  };
}
