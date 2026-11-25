/**
 * Network notices (spec 23 § 12; spec 10): one typed entry point over `queueNotice`, called inside the caller's
 * transaction (outbox pattern). Only `ustaad.*` and `staff.ustaad_*` kinds; placeholders are names, codes and counts.
 */
import type { NoticeKind } from '@mechdost/shared/notice-catalogue';
import { queueNotice, type QueueNoticeInput } from '../notices';
import type { Tx } from '../orders';

export type UstaadNoticeKind = Extract<NoticeKind, `ustaad.${string}` | `staff.ustaad_${string}`>;

export async function notifyUstaad(
  tx: Tx,
  kind: UstaadNoticeKind,
  input: Omit<QueueNoticeInput, 'kind'>,
): Promise<boolean> {
  return queueNotice(tx, { ...input, kind });
}
