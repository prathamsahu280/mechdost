/** Pure helpers of the delivery-agent screens (spec 24): countdowns, steps, links and error codes. */
import { describe, expect, it } from 'vitest';
import {
  agentStep,
  countdown,
  deliveryErrorKey,
  kmText,
  mapsHref,
  telHref,
  wrongCodeLeft,
} from '../src/lib/delivery/view';

describe('delivery view helpers', () => {
  it('counts down in m:ss and never below zero', () => {
    const now = Date.parse('2026-11-26T10:00:00Z');
    expect(countdown('2026-11-26T10:14:05Z', now)).toEqual({ seconds: 845, text: '14:05', urgent: false });
    expect(countdown('2026-11-26T10:00:40Z', now)).toEqual({ seconds: 40, text: '0:40', urgent: true });
    expect(countdown('2026-11-26T09:59:00Z', now)).toEqual({ seconds: 0, text: '0:00', urgent: true });
    expect(countdown(null, now)).toBeNull();
  });

  it('maps the job status (and where the agent says they are) to the 4 steps', () => {
    expect(agentStep('accepted', false)).toBe(1);
    expect(agentStep('accepted', true)).toBe(2);
    expect(agentStep('picked_up', false)).toBe(3);
    expect(agentStep('picked_up', true)).toBe(4);
    expect(agentStep('offered', false)).toBeNull();
    expect(agentStep('delivered', false)).toBeNull();
  });

  it('knows the contract error codes and nothing else', () => {
    expect(deliveryErrorKey('OFFER_EXPIRED')).toBe('OFFER_EXPIRED');
    expect(deliveryErrorKey('PHOTO_REQUIRED')).toBe('PHOTO_REQUIRED');
    expect(deliveryErrorKey('HTTP_500')).toBeNull();
  });

  it('reads the tries left from a wrong-code answer', () => {
    expect(wrongCodeLeft('WRONG_CODE:3')).toBe(3);
    expect(wrongCodeLeft('CODE_LOCKED:0')).toBe(0);
    expect(wrongCodeLeft('NOT_FOUND')).toBeNull();
  });

  it('builds call and map links', () => {
    expect(telHref('9876543210')).toBe('tel:+919876543210');
    expect(telHref('+91 98765 43210')).toBe('tel:+919876543210');
    expect(mapsHref({ lat: 21.25, lng: 81.63 })).toBe(
      'https://www.google.com/maps/search/?api=1&query=21.25%2C81.63',
    );
    expect(mapsHref({ address: 'C-605 Salasar Greens, 492099' })).toBe(
      'https://www.google.com/maps/search/?api=1&query=C-605%20Salasar%20Greens%2C%20492099',
    );
  });

  it('shows distance in km with one decimal', () => {
    expect(kmText(1234)).toBe('1.2');
    expect(kmText(80)).toBe('0.1');
  });
});
