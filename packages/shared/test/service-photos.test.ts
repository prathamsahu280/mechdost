import { describe, expect, it } from 'vitest';
import { OPERATIONAL_SETTINGS, settingProblem } from '../src/settings';
import {
  PHOTO_MAX_BYTES,
  photoRemovable,
  photoStageOpen,
  PublicGalleryDto,
  ServicePhotosDto,
} from '../src/service-photos';
import { SERVICE_REQUEST_STATES } from '../src/state';

describe('photo status windows (design 2026-11-15)', () => {
  it('"before" opens from confirmed through in_progress; "after" only in progress', () => {
    const before = SERVICE_REQUEST_STATES.filter((s) => photoStageOpen('before', s));
    expect(before).toEqual([
      'confirmed',
      'vehicle_received',
      'estimate_sent',
      'approved',
      'no_work_approved',
      'in_progress',
    ]);
    expect(SERVICE_REQUEST_STATES.filter((s) => photoStageOpen('after', s))).toEqual(['in_progress']);
  });

  it('removal stays possible up to ready and never after the bill', () => {
    for (const s of ['billed', 'paid', 'completed', 'cancelled', 'rejected', 'awaiting_workshop'] as const)
      expect(photoRemovable(s), s).toBe(false);
    expect(photoRemovable('ready')).toBe(true);
    expect(photoRemovable('confirmed')).toBe(true);
  });

  it('the upload limit is 8 MB', () => {
    expect(PHOTO_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('photo settings registry (rulings 2026-11-15)', () => {
  it('required by default, private by default, 6 per stage; all site-wide', () => {
    expect(OPERATIONAL_SETTINGS['service.photos_required']).toMatchObject({
      default: true,
      globalOnly: true,
    });
    expect(OPERATIONAL_SETTINGS['service.photos_public']).toMatchObject({ default: false, globalOnly: true });
    expect(OPERATIONAL_SETTINGS['service.photos_max_per_stage']).toMatchObject({
      default: 6,
      min: 1,
      max: 12,
    });
  });

  it('refuses a wrong type or an out-of-range limit', () => {
    expect(settingProblem('service.photos_public', 'yes')).not.toBeNull();
    expect(settingProblem('service.photos_max_per_stage', 0)).not.toBeNull();
    expect(settingProblem('service.photos_max_per_stage', 13)).not.toBeNull();
    expect(settingProblem('service.photos_max_per_stage', 6)).toBeNull();
  });
});

describe('response shapes', () => {
  it('carry no storage paths: unknown keys are not part of the contract and the public photo has no caption', () => {
    const ok = ServicePhotosDto.parse({
      photos: [
        {
          id: 'a',
          stage: 'before',
          caption: null,
          width: 10,
          height: 10,
          thumbUrl: '/service-photos/x/thumb',
          largeUrl: '/service-photos/x/large',
          createdAt: '2026-11-15T00:00:00.000Z',
        },
      ],
      required: true,
      maxPerStage: 6,
    });
    expect(Object.keys(ok.photos[0] ?? {})).not.toContain('path');
    expect(PublicGalleryDto.safeParse({ enabled: false, photos: [] }).success).toBe(true);
    expect(
      PublicGalleryDto.safeParse({ enabled: true, photos: [{ id: 'a', stage: 'during' }] }).success,
    ).toBe(false);
  });
});
