import { and, eq, isNull } from 'drizzle-orm';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { addWorkingMinutes, type SupportHours } from '@mechdost/shared/support-sla';
import { settings } from '../schema';
import type { Tx } from './orders';

/**
 * Support hours, first-reply target and auto-close days (admin settings `support.*`, spec 09 / 08). Kept apart from
 * the ticket repositories so every one of them can compute a deadline without importing the other.
 */
type SupportSettingKey =
  | 'support.hours_start_minute'
  | 'support.hours_end_minute'
  | 'support.first_reply_working_minutes'
  | 'support.auto_close_days';

async function intSetting(tx: Tx, key: SupportSettingKey): Promise<number> {
  const [row] = await tx
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, key), isNull(settings.cityId)))
    .limit(1);
  const v = row?.value;
  const spec = OPERATIONAL_SETTINGS[key];
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= spec.min && v <= spec.max
    ? v
    : spec.default;
}

export interface SupportSla {
  hours: SupportHours;
  firstReplyMinutes: number;
  autoCloseDays: number;
}

export async function supportSla(tx: Tx): Promise<SupportSla> {
  const [startMinute, endMinute, firstReplyMinutes, autoCloseDays] = await Promise.all([
    intSetting(tx, 'support.hours_start_minute'),
    intSetting(tx, 'support.hours_end_minute'),
    intSetting(tx, 'support.first_reply_working_minutes'),
    intSetting(tx, 'support.auto_close_days'),
  ]);
  return { hours: { startMinute, endMinute }, firstReplyMinutes, autoCloseDays };
}

/** When a request raised at `now` must have its first reply: working minutes inside the support hours, in IST. */
export async function firstReplyDueAt(tx: Tx, now: Date): Promise<Date> {
  const sla = await supportSla(tx);
  return addWorkingMinutes(now, sla.firstReplyMinutes, sla.hours);
}
