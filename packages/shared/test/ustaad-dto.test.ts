import { describe, expect, it } from 'vitest';
import { DeclareMediaDto } from '../src/ustaad/dto/media';
import { JoinDto, PatchMeDto } from '../src/ustaad/dto/members';
import { USTAAD_CONSENT_PURPOSES } from '../src/ustaad/codes';

const join = {
  track: 'ustaad',
  specialities: ['two_wheeler', 'electrical'],
  displayName: 'Ramesh Sahu',
  garageName: 'Sahu Auto Works',
  showGarage: false,
  pincode: '492001',
  areaLabel: 'Pandri',
  yearsClaimed: 8,
  workPlace: 'shop',
  verifyMethods: ['owner'],
  consents: { ustaad_profile: true, ustaad_directory: false, ustaad_training: false, ustaad_offers: false },
  turnstileToken: 'x'.repeat(30),
};

describe('Ustaad DTOs are strict (SR-5, no mass assignment)', () => {
  it('a valid join body parses', () => {
    expect(JoinDto.safeParse(join).success).toBe(true);
  });
  it('join refuses unknown keys like official or level', () => {
    expect(JoinDto.safeParse({ ...join, official: true }).success).toBe(false);
    expect(JoinDto.safeParse({ ...join, level: 'master' }).success).toBe(false);
  });
  it('join needs the required profile consent ticked', () => {
    expect(
      JoinDto.safeParse({ ...join, consents: { ...join.consents, ustaad_profile: false } }).success,
    ).toBe(false);
  });
  it('no age field anywhere in the join schema (ruling: no age check)', () => {
    // "garageName" contains the letters "age": match whole words of a camelCase key.
    const words = Object.keys(JoinDto.shape).flatMap((k) => k.split(/(?=[A-Z])/).map((w) => w.toLowerCase()));
    for (const banned of ['age', 'dob', 'birth', 'born', 'adult', 'minor'])
      expect(words).not.toContain(banned);
  });
  it('PATCH /ustaad/me refuses official: true (SR-5)', () => {
    expect(PatchMeDto.safeParse({ expectedVersion: 1, displayName: 'Ramesh' }).success).toBe(true);
    expect(PatchMeDto.safeParse({ expectedVersion: 1, official: true }).success).toBe(false);
    expect(PatchMeDto.safeParse({ expectedVersion: 1, phone: '+919999999999' }).success).toBe(false);
  });
  it('the consent purposes are the ten of spec 23 § 13', () => {
    expect(USTAAD_CONSENT_PURPOSES).toEqual([
      'ustaad_profile',
      'ustaad_directory',
      'ustaad_training',
      'ustaad_offers',
      'ustaad_location_verify',
      'ustaad_zone_count',
      'ustaad_exact_pin',
      'ustaad_voice',
      'ustaad_correction',
      'ustaad_ml_training',
    ]);
  });
});

describe('DeclareMediaDto (SR-12, SR-17)', () => {
  const ok = {
    kind: 'image',
    mime: 'image/webp',
    bytes: 200_000,
    sha256: 'a'.repeat(64),
  };
  it('a valid image declaration parses', () => {
    expect(DeclareMediaDto.safeParse(ok).success).toBe(true);
  });
  it('SVG, HTML, ZIP and executables are refused for every kind', () => {
    for (const mime of ['image/svg+xml', 'text/html', 'application/zip', 'application/x-msdownload'])
      expect(DeclareMediaDto.safeParse({ ...ok, mime }).success).toBe(false);
  });
  it('a mime of another kind is refused (video mime as image)', () => {
    expect(DeclareMediaDto.safeParse({ ...ok, mime: 'video/mp4' }).success).toBe(false);
  });
  it('video and audio need a duration', () => {
    expect(
      DeclareMediaDto.safeParse({ ...ok, kind: 'video', mime: 'video/mp4', bytes: 1_000_000 }).success,
    ).toBe(false);
    expect(
      DeclareMediaDto.safeParse({
        ...ok,
        kind: 'video',
        mime: 'video/mp4',
        bytes: 1_000_000,
        durationMs: 30_000,
      }).success,
    ).toBe(true);
  });
  it('unknown keys refused', () => {
    expect(DeclareMediaDto.safeParse({ ...ok, bucket: 'media' }).success).toBe(false);
  });
});
