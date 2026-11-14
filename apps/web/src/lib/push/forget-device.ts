import { removePushDevice } from '../notices-api';
import { savedPushDeviceId, savePushDeviceId } from './push-state';

/**
 * On sign-out the push device of this browser stops being this person's (design 2026-11-15: "remove on sign-out").
 * Light on purpose: it calls the API and the browser's own Push API, never the Firebase messaging library. Must run
 * while the session still has its token (before the Firebase sign-out).
 *
 * The browser's push subscription is always unsubscribed, whatever the API answered (security review 2026-11-15): if
 * the removal call fails, the server row would otherwise keep the token bound to the person who signed out and their
 * messages would keep arriving on a shared computer. Without a subscription FCM reports the token dead, and the
 * dispatcher revokes the row. The next person turns push on again from the card.
 */
export async function forgetPushDevice(locale: string): Promise<void> {
  const id = savedPushDeviceId();
  if (id) await removePushDevice(locale, id).catch(() => undefined);
  savePushDeviceId(null);
  await unsubscribeBrowser().catch(() => undefined);
}

async function unsubscribeBrowser(): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  const subscription = await registration?.pushManager.getSubscription();
  await subscription?.unsubscribe();
}
