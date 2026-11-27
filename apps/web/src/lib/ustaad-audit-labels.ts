/**
 * Words for Ustaad audit actions (`audit_log.action` = `ustaad.*`), shared by Admin → Ustaad → My actions and
 * Admin → Audit log (SIM-B6, SIM-B15). Returns the key in `adminUstaad.console` (`audit_<kind>`); an action without
 * words falls back to `audit_other`. Pure, no React.
 */
export const USTAAD_AUDIT_KINDS = [
  'keep',
  'remove',
  'warn',
  'restrict',
  'ban',
  'ban_proposed',
  'ban_confirmed',
  'unban',
  'unban_proposed',
  'unban_confirmed',
  'restore',
  'takedown',
  'dm_read',
  'media_view',
  'attest_owner_phone_read',
  'verification_approved',
  'verification_rejected',
  'verification_revoked',
  'appeal_upheld',
  'appeal_overturned',
  'rules_reminder',
  'evidence_sealed',
  'archive_purged',
  'level_rule_changed',
  'badge_changed',
  'tag_changed',
  'word_changed',
  'report_reason_changed',
  'reach_city_changed',
  'promotion_changed',
  'tutorial_card_changed',
  'coachmark_changed',
  'reserved_name_changed',
  'other',
] as const;
export type UstaadAuditKind = (typeof USTAAD_AUDIT_KINDS)[number];

const TABLE_EDIT =
  /^(level_rule|badge|tag|word|report_reason|reach_city|promotion|tutorial_card|coachmark|reserved_name)\.(created|updated|merged|moved)$/;

export function ustaadAuditKind(action: string): UstaadAuditKind {
  const bare = action.replace(/^ustaad\./, '');
  const table = TABLE_EDIT.exec(bare);
  const kind = table ? `${table[1] ?? ''}_changed` : bare.replace('.', '_');
  return USTAAD_AUDIT_KINDS.find((k) => k === kind) ?? 'other';
}

export function isUstaadAction(action: string): boolean {
  return action.startsWith('ustaad.');
}
