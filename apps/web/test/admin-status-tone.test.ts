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
    expect(statusTone('info')).toBe('muted');
  });

  it('gives every status family its own tone (user ruling 2026-11-25)', () => {
    // waiting / needs action: amber
    for (const c of ['pending_review', 'awaiting_shop', 'needs_routing', 'expired', 'waiting', 'requested'])
      expect(statusTone(c)).toBe('warning');
    // urgent, overdue, failed: red
    for (const c of [
      'overdue',
      'failed',
      'declined',
      'suspended',
      'rejected',
      'fatal',
      'needs_reconciliation',
    ])
      expect(statusTone(c)).toBe('danger');
    // in progress: blue
    for (const c of ['in_progress', 'packed', 'out_for_delivery', 'shipped', 'proposed', 'initiated'])
      expect(statusTone(c)).toBe('info');
    // done, paid, delivered: green
    for (const c of ['done', 'paid', 'delivered', 'refunded', 'resolved', 'processed'])
      expect(statusTone(c)).toBe('success');
    // cancelled, archived: grey
    for (const c of ['cancelled', 'archived', 'closed']) expect(statusTone(c)).toBe('muted');
    // info: navy (neutral)
    expect(statusTone('info_note')).toBe('neutral');
  });

  it('falls back to neutral for a code it does not know', () => {
    expect(statusTone('something_new')).toBe('neutral');
    expect(statusTone('')).toBe('neutral');
  });

  it('has classes for every tone, built only from existing token pairs', () => {
    for (const tone of BADGE_TONES) expect(BADGE_TONE_CLASS[tone]).toMatch(/^bg-[a-z-]+ text-[a-z-]+$/);
    expect(statusToneClass('active')).toBe('bg-success-bg text-success');
    expect(statusToneClass('overdue')).toBe('bg-error-bg text-error');
    expect(statusToneClass('in_progress')).toBe('bg-info-bg text-info');
  });
});
