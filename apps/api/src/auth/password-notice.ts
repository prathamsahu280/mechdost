import { queuePasswordChangedEmail, recordPasswordChangeSkipped } from '@mechdost/db/repo';
import type { AppDeps } from '../types';
import { isAnnounceable, type PasswordChange } from './email-actions';

type Locale = 'en' | 'hi';

/**
 * Queue the "your password was changed" notice for what Firebase reports (`change`, null when there is no account),
 * or count that nothing was worth announcing. One shared path for the page call and the sign-in catch-up, so both
 * use the same dedupe key and never send twice for one change. The mail goes to the address on the Firebase
 * record. `recordSkip` is off for the catch-up, which runs on every sign-in and would only add noise.
 */
export async function announcePasswordChange(
  db: AppDeps['db'],
  change: PasswordChange | null,
  opts: { locale: Locale; now: number; newAccountMs: number; recordSkip: boolean },
): Promise<void> {
  if (change && isAnnounceable(change, opts.now, opts.newAccountMs)) {
    await queuePasswordChangedEmail(db, {
      uid: change.uid,
      email: change.email,
      changedAt: change.changedAt,
      locale: opts.locale,
    });
  } else if (opts.recordSkip) await recordPasswordChangeSkipped(db);
}

/** What the page-call route remembers: a found change for this long, so repeat calls do not each ask Firebase. */
export const CHANGE_CACHE_MS = 30_000;
const CHANGE_CACHE_MAX = 500;

/**
 * A short memory of changes Firebase has reported, by address. Only a found change is kept: remembering "nothing
 * changed" would let someone ask just before a takeover and hide the change from the real account holder's call.
 */
export class RecentChangeCache {
  private readonly held = new Map<string, { at: number; change: PasswordChange }>();

  get(key: string, now: number): PasswordChange | null {
    const hit = this.held.get(key);
    if (!hit) return null;
    if (now - hit.at >= CHANGE_CACHE_MS) {
      this.held.delete(key);
      return null;
    }
    return hit.change;
  }

  set(key: string, change: PasswordChange, now: number): void {
    if (this.held.size >= CHANGE_CACHE_MAX) {
      const oldest = this.held.keys().next();
      if (!oldest.done) this.held.delete(oldest.value);
    }
    this.held.set(key, { at: now, change });
  }
}
