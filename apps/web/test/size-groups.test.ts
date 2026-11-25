import { describe, expect, it } from 'vitest';
import { groupSizesByRim, rimOf } from '../src/lib/catalogue/size-select';

const s = (label: string) => ({ sku: label, label });

describe('rimOf', () => {
  it.each([
    ['90/90-12 54J TL', 12],
    ['3.50-10 51J TL', 10],
    ['175/65 R14 82T', 14],
    ['145/80R12 74T TL', 12],
    ['2.75-17 41P TT', 17],
  ])('%s is a %s inch rim', (label, rim) => {
    expect(rimOf(label)).toBe(rim);
  });
  it.each(['1 L', '3.5 L', '900 ml', 'Pack of 4'])('%s has no rim', (label) => {
    expect(rimOf(label)).toBeNull();
  });
});

describe('groupSizesByRim', () => {
  const many = [
    '3.50-10 51J TL',
    '90/90-10 50J TL',
    '90/90-12 54J TL',
    '100/90-12 59J TL',
    '110/90-12 64J TL',
    '2.75-17 41P TT',
    '80/100-17 46P TL',
  ].map(s);

  it('groups seven tyre sizes by rim, smallest first, keeping the order inside a group', () => {
    const groups = groupSizesByRim(many);
    expect(groups?.map((g) => g.rim)).toEqual([10, 12, 17]);
    expect(groups?.[1]?.items.map((i) => i.label)).toEqual([
      '90/90-12 54J TL',
      '100/90-12 59J TL',
      '110/90-12 64J TL',
    ]);
  });
  it('does not group a short list', () => {
    expect(groupSizesByRim(many.slice(0, 4))).toBeNull();
  });
  it('does not group packs, or tyres of one rim only', () => {
    expect(groupSizesByRim(['1 L', '2 L', '3.5 L', '4 L', '5 L', '7.5 L', '10 L'].map(s))).toBeNull();
    expect(
      groupSizesByRim(
        ['90/90-12 a', '100/90-12 b', '110/90-12 c', '120/80-12 d', '130/70-12 e', '140/70-12 f'].map(s),
      ),
    ).toBeNull();
  });
  it('puts a size without a rim in a last group', () => {
    const groups = groupSizesByRim([...many, s('Tube 3.00')]);
    expect(groups?.at(-1)).toMatchObject({ rim: null });
    expect(groups?.at(-1)?.items).toHaveLength(1);
  });
});
