/**
 * Who may reach the network at all (setting `ustaad.access`, founder 2026-11-26), decided before the member checks.
 * `hidden` must look exactly like a path that does not exist (the API answers its generic 404; the web shows the
 * site's not-found page), so nobody learns the network is there. `sign_in` happens only when the network is open
 * (spec 23 § 3: anonymous 401). `allow` hands over to the member guard (non-members 404 on member routes).
 *
 * Preview testers (founder 2026-11-27): during `staff_preview` a named non-staff account on the admin-edited testers
 * list (`ustaad_preview_testers`) is let in like staff — for the network only; a tester holds no staff powers.
 */
import type { UstaadAccessMode } from './codes';

export type UstaadAccessDecision = 'allow' | 'hidden' | 'sign_in';

export interface UstaadViewer {
  signedIn: boolean;
  /** Holds a staff grant in a staff (two-step) session. */
  staff: boolean;
  /** On the preview testers list (only the API knows it, from the signed-in user id). */
  tester: boolean;
}

export function ustaadAccessDecision(mode: UstaadAccessMode, viewer: UstaadViewer): UstaadAccessDecision {
  if (mode === 'off') return 'hidden';
  if (mode === 'staff_preview')
    return viewer.signedIn && (viewer.staff || viewer.tester) ? 'allow' : 'hidden';
  return viewer.signedIn ? 'allow' : 'sign_in';
}
