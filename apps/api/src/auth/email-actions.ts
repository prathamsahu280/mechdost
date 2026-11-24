import { getAuth } from 'firebase-admin/auth';
import { oobCodeFromLink } from '@mechdost/shared/email-action-link';
import { firebaseAdminApp } from './firebase-app';

/**
 * One-time codes for the account emails we send ourselves (decision 2026-11-24). Firebase refuses to save a custom
 * action URL for the project (`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`), so the Admin SDK makes the link
 * (`generatePasswordResetLink`, `generateEmailVerificationLink`) and only its `oobCode` is used: the email points at
 * our own `/auth/action` page. Injected so tests never call Firebase; null in `AppDeps` → the routes answer 503.
 *
 * No `actionCodeSettings`: a continue URL only adds an "unauthorised domain" way to fail, and the page needs none.
 */
export interface EmailActionLinks {
  /** The reset code for `email`, or null when no account uses it. Throws when Firebase cannot answer. */
  passwordResetCode(email: string): Promise<string | null>;
  /** The address and verification code of Firebase account `uid`, or null when it has none or is verified. */
  verificationFor(uid: string): Promise<{ email: string; code: string } | null>;
  /**
   * When the password of the account using `email` last changed, or null when there is no such account. Firebase moves
   * `tokensValidAfterTime` on every password change or reset (it ends the other sessions), and the Admin SDK does not
   * expose `passwordUpdatedAt`, so that is the record we trust. Throws when Firebase cannot answer.
   */
  passwordChangeFor(email: string): Promise<{ uid: string; changedAt: Date } | null>;
}

/** A password change is announced only while it is this recent (the page calls right after the change). */
export const PASSWORD_CHANGE_WINDOW_MS = 10 * 60_000;
/** A change dated this far ahead of our clock cannot be real. */
const CLOCK_SKEW_MS = 60_000;

/** True when `changedAt` is within the last `PASSWORD_CHANGE_WINDOW_MS` (and not in the future). */
export function isRecentPasswordChange(changedAt: Date, now: number): boolean {
  const age = now - changedAt.getTime();
  return age >= -CLOCK_SKEW_MS && age <= PASSWORD_CHANGE_WINDOW_MS;
}

/** Admin SDK codes that mean "no such account": an answer, not a failure. */
const NO_ACCOUNT = new Set(['auth/email-not-found', 'auth/user-not-found']);

const codeOf = (err: unknown): string =>
  typeof err === 'object' && err !== null && 'code' in err && typeof err.code === 'string' ? err.code : '';

export function createFirebaseEmailActionLinks(opts: {
  projectId: string;
  keyFile?: string | null;
}): EmailActionLinks {
  const auth = getAuth(firebaseAdminApp({ projectId: opts.projectId, keyFile: opts.keyFile ?? null }));
  return {
    async passwordResetCode(email) {
      let link: string;
      try {
        link = await auth.generatePasswordResetLink(email);
      } catch (err) {
        if (NO_ACCOUNT.has(codeOf(err))) return null;
        throw err;
      }
      const code = oobCodeFromLink(link, 'resetPassword');
      if (!code) throw new Error('password reset link has no usable code');
      return code;
    },
    async verificationFor(uid) {
      let user;
      try {
        user = await auth.getUser(uid);
      } catch (err) {
        if (NO_ACCOUNT.has(codeOf(err))) return null;
        throw err;
      }
      if (!user.email || user.emailVerified) return null;
      const code = oobCodeFromLink(await auth.generateEmailVerificationLink(user.email), 'verifyEmail');
      if (!code) throw new Error('verification link has no usable code');
      return { email: user.email, code };
    },
    async passwordChangeFor(email) {
      let user;
      try {
        user = await auth.getUserByEmail(email);
      } catch (err) {
        if (NO_ACCOUNT.has(codeOf(err))) return null;
        throw err;
      }
      const at = user.tokensValidAfterTime ? new Date(user.tokensValidAfterTime) : null;
      return at && !Number.isNaN(at.getTime()) ? { uid: user.uid, changedAt: at } : null;
    },
  };
}
