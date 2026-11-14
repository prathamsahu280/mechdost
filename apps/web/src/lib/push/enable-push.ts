import { getApps, initializeApp } from '@firebase/app';
import { deleteToken, getMessaging, getToken, isSupported } from '@firebase/messaging';
import { registerPushDevice, removePushDevice } from '../notices-api';
import { PUSH_SENDER_ID, PUSH_VAPID_KEY, savedPushDeviceId, savePushDeviceId } from './push-state';

/**
 * Turning web push on and off (spec 10, design 2026-11-15). THE ONLY file that imports the Firebase messaging
 * library, and it is only ever reached through `import('@/lib/push/enable-push')` after the person taps "Turn on" or
 * "Turn off" (spec 16: the library must not load on any page view; `test/push-lazy.test.ts` keeps it that way).
 * The browser's permission question is asked here, inside that tap, never on page load.
 */
export type EnableResult = { ok: true } | { ok: false; reason: 'denied' | 'unsupported' | 'failed' };

const WORKER_PATH = '/firebase-messaging-sw.js';

function firebaseApp() {
  return (
    getApps()[0] ??
    initializeApp({
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      messagingSenderId: PUSH_SENDER_ID,
    })
  );
}

export async function enablePush(locale: string): Promise<EnableResult> {
  if (PUSH_VAPID_KEY === '' || PUSH_SENDER_ID === '') return { ok: false, reason: 'unsupported' };
  try {
    if (!(await isSupported())) return { ok: false, reason: 'unsupported' };
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'denied' };
    const registration = await navigator.serviceWorker.register(WORKER_PATH, { scope: '/' });
    await navigator.serviceWorker.ready;
    // `getToken` is marked deprecated in 0.13.x in favour of an FID-based `register` + `onRegistered`; both are
    // accepted by firebase-admin 14.5.0 (`token` or `fid`). The registration-token path is the long-proven one and
    // cannot be tried against real FCM from here, so it stays until the FID path has run in staging (decisions
    // 2026-11-15 "Bell and web push built"). The `push_devices.fcm_token` column holds either value.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- see above
    const token = await getToken(getMessaging(firebaseApp()), {
      vapidKey: PUSH_VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return { ok: false, reason: 'failed' };
    const saved = await registerPushDevice(locale, token);
    if (!saved.ok) return { ok: false, reason: 'failed' };
    savePushDeviceId(saved.data.id);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/** Stops push on this device: the server forgets the token, then the browser drops its subscription. */
export async function disablePush(locale: string): Promise<void> {
  const id = savedPushDeviceId();
  if (id) await removePushDevice(locale, id).catch(() => undefined);
  savePushDeviceId(null);
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- pairs with `getToken` above
    if (await isSupported()) await deleteToken(getMessaging(firebaseApp()));
  } catch {
    // The token is already revoked on the server; a leftover browser subscription sends nothing useful.
  }
}
