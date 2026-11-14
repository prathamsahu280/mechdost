import type { CoinEntryView, CoinRulesView } from '@mechdost/shared/coins-api';
import { COIN_ADJUST_REASONS, type CoinAdjustReason, type CoinRules } from '@mechdost/shared/coins';

/**
 * View helpers for MechDost Coins on the API (spec 20): history labels by code (hard rule 10: every word comes from
 * the locale files, never the stored English text), error codes → messages, the staff adjustment form.
 */
export type CoinEntryKey =
  | 'coins_api_entry_earn'
  | 'coins_api_entry_earn_order'
  | 'coins_api_entry_earn_first_order'
  | 'coins_api_entry_earn_workshop_booking'
  | 'coins_api_entry_redeem'
  | 'coins_api_entry_restore'
  | 'coins_api_entry_expire'
  | 'coins_api_entry_added'
  | 'coins_api_entry_removed';

export type CoinReasonKey = `coins_api_reason_${CoinAdjustReason}`;

const isAdjustReason = (v: string | null): v is CoinAdjustReason =>
  v !== null && (COIN_ADJUST_REASONS as readonly string[]).includes(v);

/** The locale key for one history row, the order code it names ('' when none) and, for staff changes, the reason. */
export function coinEntryLabel(e: CoinEntryView): {
  key: CoinEntryKey;
  code: string;
  reason?: CoinReasonKey;
} {
  const code = e.orderCode ?? '';
  switch (e.kind) {
    case 'earn':
      if (e.reasonCode === 'order') return { key: 'coins_api_entry_earn_order', code };
      if (e.reasonCode === 'first_order') return { key: 'coins_api_entry_earn_first_order', code };
      if (e.reasonCode === 'workshop_booking') return { key: 'coins_api_entry_earn_workshop_booking', code };
      return { key: 'coins_api_entry_earn', code };
    case 'redeem':
      return { key: 'coins_api_entry_redeem', code };
    case 'restore':
      return { key: 'coins_api_entry_restore', code };
    case 'expire':
      return { key: 'coins_api_entry_expire', code };
    case 'adjust':
      return {
        key: e.delta > 0 ? 'coins_api_entry_added' : 'coins_api_entry_removed',
        code,
        reason: `coins_api_reason_${isAdjustReason(e.reasonCode) ? e.reasonCode : 'other'}`,
      };
  }
}

export type CoinErrorKey =
  | 'coins_api_err_changed'
  | 'coins_api_err_balance'
  | 'coins_api_err_stale'
  | 'coins_api_err_amount'
  | 'coins_api_err_note'
  | 'coins_api_err_customer';

/** Coin error codes → their own messages; null = use the screen's common message for that code. */
export function coinErrorKey(code: string): CoinErrorKey | null {
  switch (code) {
    case 'COINS_CHANGED':
      return 'coins_api_err_changed';
    case 'INSUFFICIENT_COINS':
      return 'coins_api_err_balance';
    case 'STALE_COINS':
      return 'coins_api_err_stale';
    case 'COINS_AMOUNT':
      return 'coins_api_err_amount';
    case 'COINS_REASON':
      return 'coins_api_err_note';
    case 'NOT_FOUND':
    case 'HTTP_404':
      return 'coins_api_err_customer';
    default:
      return null;
  }
}

/** Staff form: "add"/"remove" and a whole number 1–100,000 → the signed change, or null when invalid. */
export function adjustDeltaFrom(direction: string, amount: string): number | null {
  const text = amount.trim();
  if (!/^\d{1,6}$/.test(text)) return null;
  const n = Number(text);
  if (n < 1 || n > 100_000) return null;
  if (direction === 'add') return n;
  if (direction === 'remove') return -n;
  return null;
}

/** The API's rules → the shared redemption rules (`coinRedemption`). */
export function coinRulesFromApi(r: CoinRulesView): CoinRules {
  return {
    coinValuePaise: r.coinValuePaise,
    maxRedeemBp: r.maxRedeemBp,
    minOrderPaise: r.minOrderPaise,
    expiryDays: r.expiryDays,
  };
}
