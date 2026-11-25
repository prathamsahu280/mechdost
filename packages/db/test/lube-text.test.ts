/**
 * Text helpers of the HP and BPCL lubricant imports (user 2026-11-25): title-case names with grades kept exact, one
 * product per grade, canonical pack labels with the net quantity, and typed oil properties from the grade tables.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalPack,
  cleanLubeName,
  gradeKey,
  propertiesOf,
  splitGrades,
  titleLubeName,
} from '../src/lube-import/text';

describe('titleLubeName', () => {
  it('title-cases words, keeps grades, codes and acronyms', () => {
    expect(titleLubeName('HP RACER SPLENDID 10W-30')).toBe('HP Racer Splendid 10W-30');
    expect(titleLubeName('MAK ATF-A')).toBe('MAK ATF-A');
    expect(titleLubeName('HP NATURAL GAS ENGINE OIL')).toBe('HP Natural Gas Engine Oil');
    expect(titleLubeName('HP Gear Drive EP 140')).toBe('HP Gear Drive EP 140');
    expect(titleLubeName('MAK AUTO XL CH4 15W-40')).toBe('MAK Auto XL CH4 15W-40');
  });
  it('writes every SAE grade as 10W-30 and removes the broken bytes of the export', () => {
    expect(titleLubeName('HP RACER SYNTH 10W 30')).toBe('HP Racer Synth 10W-30');
    expect(titleLubeName('HP Neo Cruise 20W40')).toBe('HP Neo Cruise 20W-40');
    expect(cleanLubeName('MAK� BRAKE FLUID XT')).toBe('MAK BRAKE FLUID XT');
    expect(cleanLubeName('MAK Evolv Synth 10W�40 10W-40')).toBe('MAK Evolv Synth 10W-40');
  });
  it('writes NLGI grades the same way and drops a repeated API class', () => {
    expect(titleLubeName('MAK RUBY GREASE NLGI Grade: 3')).toBe('MAK Ruby Grease NLGI 3');
    expect(titleLubeName('MAK TRAC CHAMPION MINI CF-4 15W-40 API CF-4')).toBe(
      'MAK Trac Champion Mini CF-4 15W-40',
    );
  });
});

describe('splitGrades', () => {
  it('does not split a single grade', () => {
    expect(splitGrades('HP RACER 10W 30')).toEqual(['HP RACER 10W 30']);
    expect(splitGrades('HP MILCY TURBO ULTRA + 10W-40')).toEqual(['HP MILCY TURBO ULTRA + 10W-40']);
  });
  it('makes one name per grade', () => {
    expect(splitGrades('HP RACER 10W-30, 20W-40, 20W-50')).toEqual([
      'HP RACER 10W-30',
      'HP RACER 20W-40',
      'HP RACER 20W-50',
    ]);
    expect(splitGrades('HP GREEN ENGINE OIL 15W-40 & 20W-50')).toEqual([
      'HP GREEN ENGINE OIL 15W-40',
      'HP GREEN ENGINE OIL 20W-50',
    ]);
    expect(splitGrades('HP GEAR OIL EP 80, 90, 140')).toEqual([
      'HP GEAR OIL EP 80',
      'HP GEAR OIL EP 90',
      'HP GEAR OIL EP 140',
    ]);
    expect(splitGrades('HYLUBE X3 10W 30, 40 & 50')).toEqual([
      'HYLUBE X3 10W 30',
      'HYLUBE X3 40',
      'HYLUBE X3 50',
    ]);
    expect(splitGrades('HP Cruise Classic 20W40 and 20W50')).toEqual([
      'HP Cruise Classic 20W40',
      'HP Cruise Classic 20W50',
    ]);
    expect(splitGrades('MAK SPIROL EP 80W, 90, 140, 80W-90')).toEqual([
      'MAK SPIROL EP 80W',
      'MAK SPIROL EP 90',
      'MAK SPIROL EP 140',
      'MAK SPIROL EP 80W-90',
    ]);
    expect(splitGrades('MAK MP GREASE NLGI Grade: 2 & 3')).toEqual([
      'MAK MP GREASE NLGI Grade: 2',
      'MAK MP GREASE NLGI Grade: 3',
    ]);
    expect(splitGrades('HP HYLUBE X-3 10W (KB), 30 (KB)')).toEqual([
      'HP HYLUBE X-3 10W (KB)',
      'HP HYLUBE X-3 30 (KB)',
    ]);
  });
});

describe('canonicalPack', () => {
  it('writes the label the shop shows and the net quantity in ml or g', () => {
    expect(canonicalPack('1 Litre')).toEqual({ label: '1 L', net: { qty: 1000, unit: 'ml' } });
    expect(canonicalPack('900 ml')).toEqual({ label: '900 ml', net: { qty: 900, unit: 'ml' } });
    expect(canonicalPack('3.5 Litre')).toEqual({ label: '3.5 L', net: { qty: 3500, unit: 'ml' } });
    expect(canonicalPack('500 ML')).toEqual({ label: '500 ml', net: { qty: 500, unit: 'ml' } });
    expect(canonicalPack('210 Litre')).toEqual({ label: '210 L', net: { qty: 210000, unit: 'ml' } });
    expect(canonicalPack('500 gm')).toEqual({ label: '500 g', net: { qty: 500, unit: 'g' } });
    expect(canonicalPack('18 Kg')).toEqual({ label: '18 kg', net: { qty: 18000, unit: 'g' } });
    expect(canonicalPack('1.2 Litre')).toEqual({ label: '1.2 L', net: { qty: 1200, unit: 'ml' } });
  });
  it('returns null for text that is not a pack size', () => {
    expect(canonicalPack('bulk')).toBeNull();
  });
});

describe('gradeKey', () => {
  it('compares grades however the page writes them', () => {
    expect(gradeKey('10W 30')).toBe('10W30');
    expect(gradeKey('MAK SPIROL EP 80W-90')).toBe('80W90');
    expect(gradeKey('HP RACER 20W40')).toBe('20W40');
    expect(gradeKey('HP GEAR OIL EP 140')).toBe('140');
    expect(gradeKey('HP KOOLGARD')).toBe('');
  });
});

describe('propertiesOf', () => {
  const rows = [
    { Grade: '15W-40', Property: 'Kinematic Viscosity @ 100�C, cSt', Value: '14.6' },
    { Grade: '15W-40', Property: 'Viscosity Index', Value: '130' },
    { Grade: '15W-40', Property: 'TBN, mg KOH/gm', Value: '8.5' },
    { Grade: '15W-40', Property: 'Flash Point, COC, �C', Value: '244' },
    { Grade: '15W-40', Property: 'Pour Point, �C', Value: '-39' },
    { Grade: '10W-30', Property: 'Viscosity Index', Value: '140' },
    { Grade: '15W-40', Property: 'Viscosity Index', Value: '130' },
  ];
  it('reads typed values for the grade of the product, once each', () => {
    expect(propertiesOf(rows, '15W40')).toEqual({
      props: {
        kv100Cst: 14.6,
        viscosityIndex: 130,
        tbnMgKohG: 8.5,
        flashPointC: 244,
        pourPointC: -39,
      },
      rejected: [],
    });
  });
  it('rejects a value that cannot be right and says so', () => {
    const out = propertiesOf(
      [
        { Grade: '11', Property: 'Pour Point, �C', Value: '36' },
        { Grade: '11', Property: 'Viscosity Index', Value: '168' },
      ],
      '5W30',
    );
    expect(out.props).toEqual({ viscosityIndex: 168 });
    expect(out.rejected).toEqual(['pourPointC 36']);
  });
});
