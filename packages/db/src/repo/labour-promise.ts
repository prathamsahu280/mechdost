import { and, inArray, isNull } from 'drizzle-orm';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { settings } from '../schema';
import type { Tx } from './orders';

/**
 * The labour promise setting (user 2026-11-15, Q105; `service.labour_promise_enabled` / `_days`, both site-wide).
 * `null` = no promise right now. A stored value outside the registry's range reads as the default, so a hand-edited
 * row can never print a promise nobody agreed to.
 */
export async function currentLabourPromiseDays(db: Tx): Promise<number | null> {
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(
      and(
        isNull(settings.cityId),
        inArray(settings.key, ['service.labour_promise_enabled', 'service.labour_promise_days']),
      ),
    );
  const value = (key: string): unknown => rows.find((r) => r.key === key)?.value;
  const enabledRaw = value('service.labour_promise_enabled');
  const enabled =
    typeof enabledRaw === 'boolean'
      ? enabledRaw
      : OPERATIONAL_SETTINGS['service.labour_promise_enabled'].default;
  if (!enabled) return null;
  const spec = OPERATIONAL_SETTINGS['service.labour_promise_days'];
  const days = value('service.labour_promise_days');
  return typeof days === 'number' && Number.isInteger(days) && days >= spec.min && days <= spec.max
    ? days
    : spec.default;
}
