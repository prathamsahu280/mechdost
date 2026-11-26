/**
 * "Your savings" wording (decision 2026-11-26): the admin edits it per language in Admin → Content (keys `savings.*`).
 * An order or account line must keep `{amount}`; an override that drops it falls back to the default, so a customer
 * never sees a line with no figure. `-` is not a hide switch here: the on/off switch is the setting.
 */
import { describe, expect, it } from 'vitest';
import { CONTENT_KEYS, contentMax, savingsLineText } from '../src/content';

describe('savings content keys', () => {
  it('are admin-editable with room for Hindi', () => {
    for (const k of ['savings.order', 'savings.account', 'savings.cart'] as const) {
      expect(CONTENT_KEYS).toContain(k);
      expect(contentMax(k)).toBeGreaterThanOrEqual(160);
    }
  });

  it('fills {amount} from the override, else the default', () => {
    expect(savingsLineText('savings.order', 'You saved {amount}', 'Saved {amount}!', '₹120')).toBe(
      'You saved ₹120',
    );
    expect(savingsLineText('savings.order', null, 'Saved {amount}', '₹120')).toBe('Saved ₹120');
    expect(savingsLineText('savings.order', '   ', 'Saved {amount}', '₹120')).toBe('Saved ₹120');
  });

  it('an order or account override without {amount} falls back to the default', () => {
    expect(savingsLineText('savings.account', 'Big savings!', 'Saved {amount}', '₹9')).toBe('Saved ₹9');
    expect(savingsLineText('savings.order', '-', 'Saved {amount}', '₹9')).toBe('Saved ₹9');
  });

  it('the cart label needs no {amount}', () => {
    expect(savingsLineText('savings.cart', 'Saving vs printed MRP', 'Estimated saving', '₹9')).toBe(
      'Saving vs printed MRP',
    );
  });
});
