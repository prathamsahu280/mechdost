import { describe, expect, it } from 'vitest';
import { footBottom } from '../e2e/state-audit/geometry.ts';

describe('footBottom: the foot of a card is where its last control sits, padded panels included (batch 3c-4)', () => {
  // API-SHOP-PORTAL at 1024 px: one card has the give-up form open. Its last control (the submit button) sits 12 px
  // above the card foot because the form is a `p-3` panel; the neighbour's button sits on the foot. Both cards end
  // with their action area, so they are aligned.
  it('climbs out of a padded panel that ends with the control', () => {
    const form = { bottom: 112, paddingBottom: 12, borderBottom: 0 };
    const actions = { bottom: 112, paddingBottom: 0, borderBottom: 0 };
    expect(footBottom(100, [form, actions])).toBe(112);
  });
  it('a button on the foot is its own foot', () => {
    expect(footBottom(112, [{ bottom: 112, paddingBottom: 0, borderBottom: 0 }])).toBe(112);
    expect(footBottom(112, [])).toBe(112);
  });
  it('does not climb past something that trails the control (a hint or error under the button)', () => {
    const wrapper = { bottom: 140, paddingBottom: 0, borderBottom: 0 };
    expect(footBottom(100, [wrapper])).toBe(100);
  });
  it('climbs through a border too, and stops at the first ancestor with content after the control', () => {
    const panel = { bottom: 113, paddingBottom: 12, borderBottom: 1 };
    const trailing = { bottom: 160, paddingBottom: 0, borderBottom: 0 };
    expect(footBottom(100, [panel, trailing])).toBe(113);
  });
});
