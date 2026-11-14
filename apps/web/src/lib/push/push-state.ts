/**
 * What this browser can do about push, and the little the website remembers about it (spec 10, design 2026-11-15).
 * Pure and light: it never imports the Firebase library (that is `enable-push.ts`, loaded only after "Turn on", spec 16).
 */

/** Public Firebase web push settings (Q103). Until both are set the "Turn on" card stays hidden and the bell still works. */
export const PUSH_VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY ?? '';
export const PUSH_SENDER_ID = process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? '';
export const PUSH_CONFIGURED =
  process.env.NEXT_PUBLIC_AUTH_MODE === 'firebase' && PUSH_VAPID_KEY !== '' && PUSH_SENDER_ID !== '';

export type PushEnvironment =
  /** No notifications, service workers or push in this browser. */
  | 'unsupported'
  /** iPhone/iPad Safari: push works only once the site is on the Home Screen. */
  | 'ios-needs-home-screen'
  /** The person said no in the browser; only the browser's site settings can undo it. */
  | 'denied'
  | 'granted'
  /** Not asked yet. */
  | 'default';

export interface PushProbe {
  userAgent: string;
  maxTouchPoints: number;
  /** Running as an installed app (Home Screen). */
  standalone: boolean;
  hasNotification: boolean;
  hasPushManager: boolean;
  hasServiceWorker: boolean;
  permission: 'default' | 'denied' | 'granted' | null;
}

const isIos = (p: PushProbe) =>
  /iPad|iPhone|iPod/.test(p.userAgent) || (p.userAgent.includes('Macintosh') && p.maxTouchPoints > 1);

export function pushEnvironment(p: PushProbe): PushEnvironment {
  if (isIos(p) && !p.standalone) return 'ios-needs-home-screen';
  if (!p.hasNotification || !p.hasPushManager || !p.hasServiceWorker || p.permission === null)
    return 'unsupported';
  return p.permission;
}

/** Reads the real browser (client only). */
export function probeBrowser(): PushProbe {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    maxTouchPoints: nav.maxTouchPoints,
    standalone: nav.standalone === true || window.matchMedia('(display-mode: standalone)').matches,
    hasNotification: 'Notification' in window,
    hasPushManager: 'PushManager' in window,
    hasServiceWorker: 'serviceWorker' in navigator,
    permission: 'Notification' in window ? Notification.permission : null,
  };
}

const SNOOZE_KEY = 'md.push.snoozeUntil';
const DEVICE_KEY = 'md.push.deviceId';

const read = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const write = (key: string, value: string | null) => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage blocked: the card simply shows again next visit.
  }
};

/** "Not now" hides the card until this moment (days from the admin setting). */
export const snoozeUntilFrom = (now: number, days: number): number => now + days * 86_400_000;
export const isSnoozed = (raw: string | null, now: number): boolean => {
  const until = Number(raw);
  return raw !== null && Number.isFinite(until) && until > now;
};

export const pushSnoozed = (now = Date.now()): boolean => isSnoozed(read(SNOOZE_KEY), now);
export const snoozePush = (days: number, now = Date.now()) => {
  write(SNOOZE_KEY, String(snoozeUntilFrom(now, days)));
};
export const clearPushSnooze = () => {
  write(SNOOZE_KEY, null);
};
export const savedPushDeviceId = (): string | null => read(DEVICE_KEY);
export const savePushDeviceId = (id: string | null) => {
  write(DEVICE_KEY, id);
};
