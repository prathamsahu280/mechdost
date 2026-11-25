/**
 * Who may reach the network at all (setting `ustaad.access`, founder 2026-11-26), decided before the member checks.
 * `hidden` must look exactly like a path that does not exist (the API answers its generic 404; the web shows the
 * site's not-found page), so nobody learns the network is there. `sign_in` happens only when the network is open
 * (spec 23 § 3: anonymous 401). `allow` hands over to the member guard (non-members 404 on member routes).
 */
import type { UstaadAccessMode } from './codes';

export type UstaadAccessDecision = 'allow' | 'hidden' | 'sign_in';

export interface UstaadViewer {
  signedIn: boolean;
  /** Holds a staff grant in a staff (two-step) session. */
  staff: boolean;
}

export function ustaadAccessDecision(mode: UstaadAccessMode, viewer: UstaadViewer): UstaadAccessDecision {
  if (mode === 'off') return 'hidden';
  if (mode === 'staff_preview') return viewer.signedIn && viewer.staff ? 'allow' : 'hidden';
  return viewer.signedIn ? 'allow' : 'sign_in';
}
