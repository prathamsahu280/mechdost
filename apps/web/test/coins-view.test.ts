import { describe, expect, it } from 'vitest';
import { settingUnit } from '../src/lib/admin-settings-view';
import { adjustDeltaFrom, coinEntryLabel, coinErrorKey, coinRulesFromApi } from '../src/lib/coins-view';

/** MechDost Coins on the API (spec 20): helpers behind the account, checkout and admin coin screens. */
describe('coinEntryLabel', () => {
  const base = { id: 'x', note: null, orderCode: null, createdAt: '', expiresAt: null };
  it('names every system row by its code, with the order code where there is one', () => {
    expect(
      coinEntryLabel({
        ...base,
        kind: 'earn',
        delta: 44,
        reasonCode: 'order',
        orderCode: 'MD-RPR-2026-AAAAAA',
      }),
    ).toEqual({
      key: 'coins_api_entry_earn_order',
      code: 'MD-RPR-2026-AAAAAA',
    });
    expect(coinEntryLabel({ ...base, kind: 'earn', delta: 50, reasonCode: 'first_order' }).key).toBe(
      'coins_api_entry_earn_first_order',
    );
    expect(coinEntryLabel({ ...base, kind: 'earn', delta: 30, reasonCode: 'workshop_booking' }).key).toBe(
      'coins_api_entry_earn_workshop_booking',
    );
    expect(coinEntryLabel({ ...base, kind: 'earn', delta: 5, reasonCode: null }).key).toBe(
      'coins_api_entry_earn',
    );
    expect(coinEntryLabel({ ...base, kind: 'redeem', delta: -40, reasonCode: 'order_redeem' }).key).toBe(
      'coins_api_entry_redeem',
    );
    expect(coinEntryLabel({ ...base, kind: 'restore', delta: 40, reasonCode: 'order_cancelled' }).key).toBe(
      'coins_api_entry_restore',
    );
    expect(coinEntryLabel({ ...base, kind: 'expire', delta: -60, reasonCode: 'expired' }).key).toBe(
      'coins_api_entry_expire',
    );
  });
  it('staff changes say added or removed and why (code), the note is kept apart', () => {
    expect(
      coinEntryLabel({ ...base, kind: 'adjust', delta: 25, reasonCode: 'goodwill', note: 'Late' }),
    ).toEqual({
      key: 'coins_api_entry_added',
      reason: 'coins_api_reason_goodwill',
      code: '',
    });
    expect(coinEntryLabel({ ...base, kind: 'adjust', delta: -5, reasonCode: 'nonsense' }).reason).toBe(
      'coins_api_reason_other',
    );
  });
});

describe('coinErrorKey', () => {
  it('maps coin codes to their own messages and leaves the rest to the common ones', () => {
    expect(coinErrorKey('COINS_CHANGED')).toBe('coins_api_err_changed');
    expect(coinErrorKey('INSUFFICIENT_COINS')).toBe('coins_api_err_balance');
    expect(coinErrorKey('STALE_COINS')).toBe('coins_api_err_stale');
    expect(coinErrorKey('COINS_AMOUNT')).toBe('coins_api_err_amount');
    expect(coinErrorKey('COINS_REASON')).toBe('coins_api_err_note');
    expect(coinErrorKey('NOT_FOUND')).toBe('coins_api_err_customer');
    expect(coinErrorKey('RATE_LIMITED')).toBeNull();
  });
});

describe('adjustDeltaFrom', () => {
  it('turns the direction and a whole number into a signed change, or null', () => {
    expect(adjustDeltaFrom('add', '25')).toBe(25);
    expect(adjustDeltaFrom('remove', ' 10 ')).toBe(-10);
    expect(adjustDeltaFrom('add', '0')).toBeNull();
    expect(adjustDeltaFrom('add', '1.5')).toBeNull();
    expect(adjustDeltaFrom('add', '100001')).toBeNull();
    expect(adjustDeltaFrom('sideways', '5')).toBeNull();
  });
});

describe('coinRulesFromApi', () => {
  it('keeps the redemption rules the checkout maths needs', () => {
    expect(
      coinRulesFromApi({
        coinValuePaise: 100,
        maxRedeemBp: 1_000,
        minOrderPaise: 0,
        expiryDays: 180,
        unlockDays: 8,
        earnOrderBp: 0,
        firstOrderBonus: 0,
        workshopBookingBonus: 0,
      }),
    ).toEqual({ coinValuePaise: 100, maxRedeemBp: 1_000, minOrderPaise: 0, expiryDays: 180 });
  });
});

describe('coin settings units', () => {
  it('shows basis points and coin counts with their own units', () => {
    expect(settingUnit('coins.max_redeem_bp')).toBe('bp');
    expect(settingUnit('coins.first_order_bonus')).toBe('coins');
    expect(settingUnit('coins.value_paise')).toBe('rupees');
    expect(settingUnit('coins.expiry_days')).toBe('days');
  });
});
