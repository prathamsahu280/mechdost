/**
 * Account deletion request (design 2026-11-15 item 6): the request is the support ticket kind built by "Support next
 * tier" (spec 09 / spec 01: staff confirm before anything is deleted); Privacy has no second deletion system. The
 * Privacy page links to Account → Support at the deletion request section (`DeletionRequestApi`), which carries this
 * id (wired at the merge, 2026-11-15; was a `topic=account_deletion` placeholder, Q140).
 */
export const DELETION_SECTION_ID = 'delete-account';

export const ACCOUNT_DELETION_HOOK = {
  path: '/account/support',
  hash: DELETION_SECTION_ID,
} as const;
