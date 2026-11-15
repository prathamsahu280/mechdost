import { POLICY_KEYS, type PolicyDoc, type PolicyKey } from '@mechdost/shared/policy';

/**
 * Small helpers for policy pages and the policy editor preview (design 2026-11-15 item 5). Pure: no React, no fetch.
 */

/** "15 November 2026" / "15 नवंबर 2026" from a `YYYY-MM-DD` date (UTC, so the day never shifts with the time zone). */
export function policyDateLabel(isoDate: string, locale: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(d);
}

/** Public path of each policy page (the page shows the published text, else its built-in text). */
export const POLICY_PATH: Record<PolicyKey, string> = {
  'policy.privacy': '/policies/privacy',
  'policy.returns': '/policies/returns',
  'policy.delivery': '/policies/delivery',
  'policy.service': '/policies/service-terms',
};

/** The built-in section keys of each policy page, in page order (the `policies.<page>.<key>Title/Body` texts). */
export const POLICY_PAGES: Record<
  PolicyKey,
  { namespace: string; sections: readonly { key: string; emoji: string }[] }
> = {
  'policy.privacy': {
    namespace: 'policies.privacy',
    sections: [
      { key: 'who', emoji: '🏢' },
      { key: 'collect', emoji: '🗂️' },
      { key: 'purpose', emoji: '🎯' },
      { key: 'share', emoji: '🤝' },
      { key: 'analytics', emoji: '📊' },
      { key: 'errors', emoji: '🛠️' },
      { key: 'safe', emoji: '🔒' },
      { key: 'rights', emoji: '✋' },
    ],
  },
  'policy.delivery': {
    namespace: 'policies.delivery',
    sections: [
      { key: 'pin', emoji: '📍' },
      { key: 'prices', emoji: '🧾' },
      { key: 'confirm', emoji: '🏪' },
      { key: 'code', emoji: '🔑' },
      { key: 'pay', emoji: '💵' },
      { key: 'cancel', emoji: '✋' },
    ],
  },
  'policy.returns': {
    namespace: 'policies.returns',
    sections: [
      { key: 'noReturns', emoji: '🚫' },
      { key: 'faulty', emoji: '🛠️' },
      { key: 'unfulfilled', emoji: '↩️' },
      { key: 'refunds', emoji: '💳' },
      { key: 'coins', emoji: '🪙' },
    ],
  },
  'policy.service': {
    namespace: 'policies.service',
    sections: [
      { key: 'find', emoji: '📍' },
      { key: 'proposal', emoji: '🗓️' },
      { key: 'estimate', emoji: '📝' },
      { key: 'cancel', emoji: '✋' },
      { key: 'bill', emoji: '💳' },
      { key: 'pickup', emoji: '🚗' },
    ],
  },
};

/** The claim window the built-in returns text names (`{days}`); the same value the page passes. */
const BUILT_IN_DAYS = '7';

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const textOf = (v: unknown): string =>
  typeof v === 'string' ? v.replaceAll("''", "'").replaceAll('{days}', BUILT_IN_DAYS) : '';

/**
 * The built-in text of a policy page as an editable document ("Start from the current text"), read from the locale
 * messages in the language being edited. `{company}`, `{address}` and `{phone}` stay as placeholders. Null when the
 * page has no built-in text in `messages`.
 */
export function builtInPolicy(messages: unknown, key: PolicyKey, today: string): PolicyDoc | null {
  const page = POLICY_PAGES[key];
  let node: unknown = messages;
  for (const part of page.namespace.split('.')) node = isRecord(node) ? node[part] : null;
  if (!isRecord(node)) return null;
  const sections = page.sections.flatMap(({ key: k, emoji }) => {
    const heading = textOf(node[`${k}Title`]);
    const body = textOf(node[`${k}Body`]);
    return heading && body ? [{ heading, body, emoji }] : [];
  });
  const title = textOf(node.title);
  return title && sections.length > 0 ? { title, lead: textOf(node.lead), updatedOn: today, sections } : null;
}

/** Keys of the four editable policies, for the editor's list. */
export const EDITABLE_POLICIES: readonly PolicyKey[] = POLICY_KEYS;

/** A blank document to start from (when the built-in text cannot be copied). */
export const blankPolicy = (today: string): PolicyDoc => ({
  title: '',
  lead: '',
  updatedOn: today,
  sections: [{ heading: '', body: '' }],
});
