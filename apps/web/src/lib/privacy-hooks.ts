/**
 * HOOK: account deletion request (design 2026-11-15 item 6). The deletion request is the support ticket kind built by
 * "Support next tier" (spec 09: `account`, staff confirm before anything is deleted); Privacy must not grow a second
 * deletion system. Until that ticket kind is on this branch, the Privacy page sends the customer to the support
 * section with `topic=account_deletion`, which the support screen is to read to open the right ticket. Swap this
 * single constant for the real route when it lands (queued as Q140 in docs/questions-for-user.md).
 */
export const ACCOUNT_DELETION_HOOK = {
  path: '/account/support',
  query: { topic: 'account_deletion' },
} as const;
