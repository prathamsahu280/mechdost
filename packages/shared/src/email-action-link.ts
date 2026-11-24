/**
 * Email action links on our own domain (decision 2026-11-24). Firebase refuses a custom action URL for the project
 * (`EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`), so the API asks the Admin SDK for the link, takes `mode` and `oobCode` out
 * of it and sends the email itself, pointing at `{WEB_BASE_URL}/auth/action` (the page in
 * `apps/web/src/components/auth/email-action.tsx`). Pure helpers: unit-tested without Firebase.
 */
export const SENT_ACTION_MODES = ['resetPassword', 'verifyEmail'] as const;
export type SentActionMode = (typeof SENT_ACTION_MODES)[number];

/** What a one-time code looks like (the page refuses anything else). */
export const OOB_CODE = /^[A-Za-z0-9_-]{8,512}$/;

/**
 * The one-time code inside a link made by `generate*Link`, or null when the link is not for `expected` or the code
 * does not look like one (the caller then sends nothing instead of a broken link).
 */
export function oobCodeFromLink(link: string, expected: SentActionMode): string | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const code = url.searchParams.get('oobCode');
  if (url.searchParams.get('mode') !== expected || code === null || !OOB_CODE.test(code)) return null;
  return code;
}

/** Path and query of the action page link (the email adds the site address, and `/hi` for Hindi). */
export function emailActionPath(p: { mode?: string; oobCode?: string; lang?: string }): string {
  const q = new URLSearchParams({ mode: p.mode ?? '', oobCode: p.oobCode ?? '', lang: p.lang ?? 'en' });
  return `/auth/action?${q.toString()}`;
}
