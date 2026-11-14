import { removePushDevice } from '../notices-api';
import { savedPushDeviceId, savePushDeviceId } from './push-state';

/**
 * On sign-out the push device of this browser stops being this person's (design 2026-11-15: "remove on sign-out").
 * Light on purpose: it only calls the API, never the Firebase messaging library. Must run while the session still
 * has its token (before the Firebase sign-out). A failure is ignored: the server also moves the token to whoever
 * registers next on this browser, and FCM revokes dead tokens.
 */
export async function forgetPushDevice(locale: string): Promise<void> {
  const id = savedPushDeviceId();
  if (!id) return;
  await removePushDevice(locale, id).catch(() => undefined);
  savePushDeviceId(null);
}
