import { describe, expect, it } from 'vitest';
import { BADGE_TONES, BADGE_TONE_CLASS, statusTone, statusToneClass } from '../src/lib/admin-status-tone';

describe('admin status → badge tone', () => {
  it('maps partner, shop and workshop statuses', () => {
    expect(statusTone('active')).toBe('success');
    expect(statusTone('approved')).toBe('success');
    expect(statusTone('paused')).toBe('warning');
    expect(statusTone('suspended')).toBe('danger');
    expect(statusTone('pending')).toBe('neutral');
  });

  it('maps customer block levels and error levels', () => {
    expect(statusTone('cod_only')).toBe('warning');
    expect(statusTone('orders')).toBe('warning');
    expect(statusTone('full')).toBe('danger');
    expect(statusTone('fatal')).toBe('danger');
    expect(statusTone('warning')).toBe('warning');
    expect(statusTone('debug')).toBe('muted');
  });

  it('falls back to neutral for a code it does not know', () => {
    expect(statusTone('something_new')).toBe('neutral');
    expect(statusTone('')).toBe('neutral');
  });

  it('has classes for every tone, built only from existing token pairs', () => {
    for (const tone of BADGE_TONES) expect(BADGE_TONE_CLASS[tone]).toMatch(/^bg-[a-z-]+ text-[a-z-]+$/);
    expect(statusToneClass('active')).toBe('bg-success-bg text-success');
  });
});
