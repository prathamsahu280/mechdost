import { describe, expect, it } from 'vitest';
import { defaultExportRange, exportErrorKey, localRangeError } from '../src/lib/admin-exports-view';

describe('defaultExportRange', () => {
  it('is the last 30 IST days ending today', () => {
    // 2026-11-15 20:00 UTC is already 16 Nov in India.
    expect(defaultExportRange(new Date('2026-11-15T20:00:00Z'))).toEqual({
      from: '2026-10-18',
      to: '2026-11-16',
    });
    expect(defaultExportRange(new Date('2026-11-15T10:00:00Z'))).toEqual({
      from: '2026-10-17',
      to: '2026-11-15',
    });
  });
});

describe('exportErrorKey', () => {
  it('maps the API codes to the screen messages', () => {
    expect(exportErrorKey('EXPORT_RANGE_TOO_LONG')).toBe('err_rangeLong');
    expect(exportErrorKey('EXPORT_RANGE_ORDER')).toBe('err_rangeOrder');
    expect(exportErrorKey('EXPORT_RANGE_DATE')).toBe('err_rangeDate');
    expect(exportErrorKey('EXPORT_TOO_LARGE')).toBe('err_tooLarge');
    expect(exportErrorKey('EXPORT_LINK_EXPIRED')).toBe('err_linkExpired');
    expect(exportErrorKey('EXPORT_LINK_INVALID')).toBe('err_linkExpired');
    expect(exportErrorKey('EXPORTS_UNAVAILABLE')).toBe('err_unavailable');
    expect(exportErrorKey('SOMETHING_ELSE')).toBeNull();
  });
});

describe('localRangeError', () => {
  it('checks the range before any request is made', () => {
    expect(localRangeError('2026-11-01', '2026-11-15')).toBeNull();
    expect(localRangeError('', '2026-11-15')).toBe('err_rangeDate');
    expect(localRangeError('2026-11-15', '2026-11-01')).toBe('err_rangeOrder');
    expect(localRangeError('2026-01-01', '2026-11-15')).toBe('err_rangeLong');
  });
});
