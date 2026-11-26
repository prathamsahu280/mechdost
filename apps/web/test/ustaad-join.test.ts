/**
 * The 5-step Ustaad join (spec 23 § 4 flow 1, § 4a; plan task B1): one required consent, the three optional ones
 * start unticked, no age field anywhere, the body is exactly the strict API DTO, and each step blocks only on its own
 * fields.
 */
import { describe, expect, it } from 'vitest';
import { JoinDto } from '@mechdost/shared/ustaad/dto/members';
import {
  emptyJoinDraft,
  JOIN_STEPS,
  joinBody,
  joinErrorKey,
  stepErrors,
  type JoinDraft,
} from '../src/lib/ustaad/join';

const filled = (): JoinDraft => ({
  ...emptyJoinDraft(),
  track: 'ustaad',
  specialities: ['two_wheeler', 'electrical'],
  displayName: 'Ramesh Sahu',
  garageName: 'Sahu Auto',
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: '8',
  workPlace: 'shop',
  verifyMethods: ['owner'],
  consents: { ...emptyJoinDraft().consents, ustaad_profile: true },
});

describe('Ustaad join draft', () => {
  it('has five steps in the prototype order', () => {
    expect(JOIN_STEPS).toEqual(['who', 'work', 'details', 'verify', 'choices']);
  });

  it('starts with every consent unticked (the required one too) and no track picked', () => {
    const d = emptyJoinDraft();
    expect(d.consents).toEqual({
      ustaad_profile: false,
      ustaad_directory: false,
      ustaad_training: false,
      ustaad_offers: false,
    });
    expect(d.track).toBeNull();
  });

  it('never asks for an age or a date of birth (ruling 2026-11-26)', () => {
    const keys = [...Object.keys(emptyJoinDraft()), ...Object.keys(JoinDto.shape)];
    for (const k of keys) expect(k).not.toMatch(/^(age|ageYears|dob)$|birth|adult/i);
  });

  it('a prefill from an old application fills name and PIN (steps 3–4)', () => {
    const d = emptyJoinDraft({ name: 'Old Applicant', pincode: '492004' });
    expect(d).toMatchObject({ displayName: 'Old Applicant', pincode: '492004' });
  });

  it('each step blocks only on its own fields', () => {
    const d = emptyJoinDraft();
    expect(Object.keys(stepErrors('who', d))).toEqual(['track']);
    expect(Object.keys(stepErrors('work', d))).toEqual(['specialities']);
    expect(Object.keys(stepErrors('details', d)).sort()).toEqual(
      ['areaLabel', 'displayName', 'pincode', 'workPlace', 'yearsClaimed'].sort(),
    );
    expect(stepErrors('verify', d)).toEqual({}); // "Do it later" is a fine answer
    expect(Object.keys(stepErrors('choices', d))).toEqual(['ustaad_profile']);
    for (const s of JOIN_STEPS) expect(stepErrors(s, filled())).toEqual({});
  });

  it('a bad PIN and years out of range are refused', () => {
    expect(stepErrors('details', { ...filled(), pincode: '12345' })).toHaveProperty('pincode');
    expect(stepErrors('details', { ...filled(), yearsClaimed: '61' })).toHaveProperty('yearsClaimed');
  });

  it('only the required consent ticked → a valid body for the strict API DTO', () => {
    const body = joinBody(filled(), { turnstileToken: 'human-token-123', via: 'partners_apply' });
    expect(JoinDto.safeParse(body).success).toBe(true);
    expect(body.consents).toEqual({
      ustaad_profile: true,
      ustaad_directory: false,
      ustaad_training: false,
      ustaad_offers: false,
    });
    expect(body.via).toBe('partners_apply');
    expect(body).not.toHaveProperty('fromApplication');
    expect(
      joinBody(filled(), {
        turnstileToken: 'x'.repeat(12),
        via: 'ustaad',
        fromApplication: 'PA-RPR-2026-MECHA1',
      }),
    ).toHaveProperty('fromApplication', 'PA-RPR-2026-MECHA1');
  });

  it('an empty garage name is sent as null, the certificate proof never', () => {
    const body = joinBody(
      { ...filled(), garageName: '  ', verifyMethods: ['owner', 'vouch'] },
      { turnstileToken: 'human-token-123', via: 'ustaad' },
    );
    expect(body.garageName).toBeNull();
    expect(body.verifyMethods).toEqual(['owner', 'vouch']);
  });

  it('API codes map to friendly messages', () => {
    expect(joinErrorKey('USTAAD_REGION')).toBe('errRegion');
    expect(joinErrorKey('NAME_RESERVED')).toBe('errName');
    expect(joinErrorKey('USTAAD_ALREADY_MEMBER')).toBe('errAlready');
    expect(joinErrorKey('USTAAD_INVITE_INVALID')).toBe('errInvite');
    expect(joinErrorKey('SOMETHING_ELSE')).toBe('errGeneric');
  });
});
