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
  };
}
