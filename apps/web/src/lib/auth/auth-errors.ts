/**
 * Pure mapping of Firebase Auth outcomes for the sign-in flow (unit-tested without the SDK; review B15).
 */
export type CodeFail = 'otp' | 'expired' | 'rate' | 'unavailable';

/** A failed phone-code check: an expired code offers "send a new code"; a wrong one asks to re-type. */
export function codeFailFor(code: string | undefined): CodeFail {
  if (code === 'auth/code-expired') return 'expired';
  if (code === 'auth/invalid-verification-code') return 'otp';
  if (code === 'auth/too-many-requests') return 'rate';
  return 'unavailable';
}

export type PhoneFail = 'phone' | 'rate' | 'captcha' | 'network' | 'unavailable';

/** Why a phone-code send failed, from the Firebase error code: each common cause gets its own message. */
export function phoneSendFailFor(code: string | undefined): PhoneFail {
  switch (code) {
    case 'auth/invalid-phone-number':
      return 'phone';
    case 'auth/too-many-requests':
    case 'auth/quota-exceeded':
      return 'rate';
    case 'auth/captcha-check-failed':
    case 'auth/invalid-app-credential':
    case 'auth/missing-app-credential':
      return 'captcha';
    case 'auth/network-request-failed':
      return 'network';
    default:
      return 'unavailable';
  }
}

/** The Firebase error code for analytics: only a plain `auth/...` code, never free text (no phone numbers). */
export function analyticsAuthCode(code: string | undefined): string {
  return code && /^auth\/[a-z0-9-]{1,60}$/.test(code) ? code : 'unknown';
}

/** True when this email + password is already linked (a sign-up retry after linking succeeded). */
export function passwordLinkedFor(
  providerData: readonly { providerId: string; email: string | null }[],
  email: string,
): boolean {
  const wanted = email.trim().toLowerCase();
  return providerData.some((p) => p.providerId === 'password' && p.email?.toLowerCase() === wanted);
}

/**
 * True when the session already has an email + password linked: a sign-up retry after the link step succeeded. The
 * API refuses that session (`PROVIDER_NOT_ALLOWED`), so the retry skips the phone-session profile call (2026-11-16).
 */
export function hasPasswordProvider(providerData: readonly { providerId: string }[]): boolean {
  return providerData.some((p) => p.providerId === 'password');
}
