/**
 * Pure helpers for the email link page `/auth/action` (Firebase's custom action URL, 2026-11-23): reading the query
 * Firebase appends, mapping its error codes, and accepting a `continueUrl` only when it stays on this site.
 * Unit-tested without the SDK.
 */
export const EMAIL_ACTION_MODES = [
  'verifyEmail',
  'resetPassword',
  'recoverEmail',
  'verifyAndChangeEmail',
] as const;
export type EmailActionMode = (typeof EMAIL_ACTION_MODES)[number];

export interface ActionParams {
  mode: EmailActionMode | null;
  /** The one-time code, only when it looks like one (letters, digits, `_`, `-`). */
  oobCode: string | null;
  continueUrl: string | null;
}

const OOB_CODE = /^[A-Za-z0-9_-]{8,512}$/;

export function parseActionParams(query: { get(name: string): string | null }): ActionParams {
  const mode = query.get('mode');
  const code = query.get('oobCode');
  return {
    mode: EMAIL_ACTION_MODES.find((m) => m === mode) ?? null,
    oobCode: code !== null && OOB_CODE.test(code) ? code : null,
    continueUrl: query.get('continueUrl'),
  };
}

export type ActionFail = 'invalid' | 'expired' | 'disabled' | 'network' | 'unavailable' | 'weak';

/** Why a link or the new password failed, from the Firebase error code. */
export function actionFailFor(code: string | undefined): ActionFail {
  switch (code) {
    case 'auth/expired-action-code':
      return 'expired';
    case 'auth/invalid-action-code':
    case 'auth/user-not-found':
      return 'invalid';
    case 'auth/user-disabled':
      return 'disabled';
    case 'auth/network-request-failed':
      return 'network';
    case 'auth/weak-password':
      return 'weak';
    default:
      return 'unavailable';
  }
}

/**
 * The page to continue to after the action: a path on this site, or a full URL on `host` (a `continueUrl` pointing
 * elsewhere is ignored: no open redirect). Returns a path with its query, or null.
 */
export function safeContinuePath(continueUrl: string | null, host: string): string | null {
  if (!continueUrl) return null;
  try {
    const url = new URL(continueUrl, `https://${host}`);
    if (url.host !== host || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null;
    if (url.pathname.startsWith('//') || url.pathname.startsWith('/auth/action')) return null;
    return `${url.pathname}${url.search}`;
  } catch {
    return null;
  }
}
