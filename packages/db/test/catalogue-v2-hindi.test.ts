/**
 * Hindi of the imported catalogue (hard rule 10; live audit 2026-11-22 item 3): the translations file reaches names,
 * highlight values, range names and the fitment text, never leaves generic English words behind, and the spec
 * summary writes viscosity grades as "5W-40".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hindiLeftovers } from '@mechdost/shared/catalogue-hindi';
import {
  emptyReport,
  newPlanState,
  planHindiLeftovers,
  planSection,
  SECTIONS,
  summarise,
  type PlannedProduct,
  type Section,
  type SourceProduct,
} from '../src/catalogue-v2';

type Fixture = Record<Section, SourceProduct[]> & { img: never[] };
const fx = JSON.parse(
  readFileSync(new URL('./fixtures/catalogue-v2.json', import.meta.url), 'utf8'),
) as Fixture;

function plan(translations?: Map<string, string>): PlannedProduct[] {
  const report = emptyReport();
  const state = newPlanState();
  const products: PlannedProduct[] = [];
  for (const section of SECTIONS)
    products.push(
      ...planSection({ section, products: fx[section], images: fx.img, translations }, report, state),
    );
  summarise(products, report);
  return products;
}

describe('translations reach more than descriptions', () => {
  const tr = new Map([
    ['SYNTHETIC TECHNOLOGY', 'सिंथेटिक टेक्नोलॉजी'],
    ['Aerosol', 'एरोसोल'],
    ['2-WHEELER', 'दोपहिया'],
    ['KELVINN BATTERY TERMINAL PROTECTANT', 'KELVINN बैटरी टर्मिनल प्रोटेक्टेंट'],
  ]);

  it('highlight values', () => {
    const duramax = plan(tr).find((p) => p.name === 'DURAMAX LE');
    expect(duramax?.highlightsHi).toContain('ऑयल टाइप: सिंथेटिक टेक्नोलॉजी');
    expect(plan().find((p) => p.name === 'DURAMAX LE')?.highlightsHi).not.toContain(
      'ऑयल टाइप: सिंथेटिक टेक्नोलॉजी',
    );
  });

  it('range names (and keeps the machine value an earlier run wrote, to tell unedited rows)', () => {
    const p = plan(tr).find((x) => x.name === 'KELVINN BATTERY TERMINAL PROTECTANT');
    expect(p?.nameHi).toBe('KELVINN बैटरी टर्मिनल प्रोटेक्टेंट');
    expect(p?.range?.nameHi).toBe('एरोसोल');
    expect(p?.range?.nameHiMachine).toBeTypeOf('string');
  });

  it('the fitment text (compatibility)', () => {
    const exide = plan(tr).find((p) => p.name === 'Exide Xplore');
    expect(exide?.compatibility).toBe('2-WHEELER');
    expect(exide?.compatibilityHi).toBe('दोपहिया');
  });
});

describe('viscosity grades in the spec summary', () => {
  it('are written 5W-40 style, in both languages, while the stored attribute keeps its filter value', () => {
    const activ = plan().find((p) => p.name === 'ACTIV 4T 10W-30');
    expect(activ?.attributes.saeGrade).toBe('10W30');
    expect(activ?.specSummary).toContain('10W-30');
    expect(activ?.specSummary).not.toContain('10W30');
    expect(activ?.specSummaryHi).toContain('10W-30');
  });
});

describe('hindiLeftovers (the Hindi-coverage check for imported text)', () => {
  it('lets brand, series, standards, units and codes through', () => {
    expect(hindiLeftovers('KELVINN बैटरी टर्मिनल KLENE 5W-40 API SN DOT 4 900 ml GULF PRIDE')).toEqual([]);
  });
  it('reports generic English words', () => {
    expect(hindiLeftovers('Non एरोसोल Mixing ratio')).toEqual(['Non', 'Mixing', 'ratio']);
    expect(hindiLeftovers('KELVINN HEADLIGHT RESTORER')).toEqual(['HEADLIGHT', 'RESTORER']);
  });
});

describe('planHindiLeftovers (the importer refuses a real run while any is left)', () => {
  it('lists the English words of the Hindi text a plan would write', () => {
    const kelvinn = plan().filter((p) => p.name.startsWith('KELVINN'));
    const found = planHindiLeftovers(kelvinn);
    expect(found.some((f) => f.field === 'name_hi' && f.words.includes('TERMINAL'))).toBe(true);
  });
  it('is empty once the committed translations are applied to the fixture', () => {
    const tr = new Map(Object.entries(committed));
    // The brands of the first import (the price lists); other brands are translated when they are imported.
    const imported = new Set(['castrol', 'gulf', 'exide', 'tata-green', 'kelvinn', 'cerafence', 'elvi']);
    expect(planHindiLeftovers(plan(tr).filter((p) => imported.has(p.brand.slug)))).toEqual([]);
  });
});

const committed = JSON.parse(
  readFileSync(new URL('../../../docs/catalogue/catalogue-v2-translations-hi.json', import.meta.url), 'utf8'),
) as Record<string, string>;

describe('the committed translations file', () => {
  const file = JSON.parse(
    readFileSync(
      new URL('../../../docs/catalogue/catalogue-v2-translations-hi.json', import.meta.url),
      'utf8',
    ),
  ) as Record<string, string>;

  it('has no English words left in any Hindi value', () => {
    const bad = Object.entries(file).flatMap(([en, hi]) => {
      const words = hindiLeftovers(hi);
      return words.length > 0 ? [`${en.slice(0, 60)} => ${words.join(', ')}`] : [];
    });
    expect(bad).toEqual([]);
  });

  it('has a non-empty Hindi value for every key', () => {
    expect(Object.entries(file).filter(([, hi]) => hi.trim() === '')).toEqual([]);
  });
});
