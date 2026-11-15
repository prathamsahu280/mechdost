/**
 * Shop portal next tier, part 2 (design 2026-11-15, items 4 to 7): API codes map to texts present in English and
 * Hindi, the performance numbers read right, every key the screens use exists in both languages, and the Hindi
 * texts carry no English words outside the allowed Latin (codes, units, brand, column names).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SHOP_CSV_ERROR_CODES } from '@mechdost/shared/shop-csv';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';
import {
  acceptTime,
  APPLICATION_REF,
  barWidth,
  csvFileKey,
  csvProblemKey,
  normaliseRef,
  percentOf,
  ratingText,
  stageIndex,
  statusErrorKey,
} from '../src/lib/shop-tools-view';

describe('texts', () => {
  it('en and hi carry the same keys under shopTier2', () => {
    expect(Object.keys(hi.shopTier2).sort()).toEqual(Object.keys(en.shopTier2).sort());
  });

  it('every CSV problem and file code maps to a key in both languages', () => {
    for (const code of SHOP_CSV_ERROR_CODES) {
      expect(en.shopTier2).toHaveProperty(csvProblemKey(code));
      expect(hi.shopTier2).toHaveProperty(csvProblemKey(code));
    }
    for (const code of [
      'CSV_HEADER',
      'CSV_TOO_LARGE',
      'CSV_HAS_ERRORS',
      'TYPE',
      'HTTP_429',
      'NETWORK',
      'WAT',
    ]) {
      expect(en.shopTier2).toHaveProperty(csvFileKey(code));
      expect(hi.shopTier2).toHaveProperty(csvFileKey(code));
    }
    expect(csvFileKey('CSV_HEADER')).toBe('csvFile_HEADER');
    expect(csvFileKey('HTTP_429')).toBe('csvFile_RATE_LIMITED');
    expect(csvFileKey('UNKNOWN')).toBe('csvFile_generic');
  });

  it('status codes map to keys in both languages; unknown codes get the generic line', () => {
    for (const code of ['NOT_FOUND', 'RATE_LIMITED', 'PHONE_REQUIRED', 'HTTP_429', 'HTTP_500']) {
      expect(en.shopTier2).toHaveProperty(statusErrorKey(code));
      expect(hi.shopTier2).toHaveProperty(statusErrorKey(code));
    }
    expect(statusErrorKey('HTTP_500')).toBe('statusErr_generic');
  });

  it('every shopTier2 key the screens use exists in both languages', () => {
    const files = [
      '../src/components/portal/shop-csv-api.tsx',
      '../src/components/portal/shop-performance-api.tsx',
      '../src/components/portal/shop-slip-api.tsx',
      '../src/components/portal/shop-slip-screen.tsx',
      '../src/components/partners/partner-status.tsx',
      '../src/components/partners/application-status.tsx',
      '../src/components/portal/shop-portal-api.tsx',
    ];
    const used = new Set<string>();
    for (const f of files) {
      const text = readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');
      for (const m of text.matchAll(/\bt2?\(\s*'([A-Za-z_0-9]+)'/g)) if (m[1]) used.add(m[1]);
    }
    // Keys built from a variable are checked through their parts above (csv, status, stage and kind families).
    const missing = [...used].filter((k) => !(k in en.shopTier2) && !(k in en.portal) && !(k in en.apply));
    expect(missing.filter((k) => /^(csv|slip|perf|status|stage|detail)/.test(k))).toEqual([]);
    for (const stage of ['new', 'in_review', 'approved', 'rejected']) {
      expect(en.shopTier2).toHaveProperty(`stage_${stage}`);
      expect(en.shopTier2).toHaveProperty(`detail_${stage}`);
    }
    for (const kind of ['seller', 'garage', 'mechanic'])
      expect(hi.shopTier2).toHaveProperty(`statusKind_${kind}`);
  });

  it('Hindi texts have no English words, apart from codes, column names, units and the brand', () => {
    const allowed = new Set(
      'sku stock active requested_price yes no pin pa rpr abc mb mechdost mrp upi gstin csv one other plural count'.split(
        ' ',
      ),
    );
    const offenders: string[] = [];
    for (const [key, value] of Object.entries(hi.shopTier2)) {
      // ICU arguments, plural words and the example reference are not copy.
      const text = value.replace(/\{[^}]*\}/g, ' ').replace(/PA-[A-Z0-9-]+/g, ' ');
      for (const word of text.match(/[A-Za-z_]{2,}/g) ?? [])
        if (!allowed.has(word.toLowerCase())) offenders.push(`${key}: ${word}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('numbers', () => {
  it('percentages, bar widths, times and stars', () => {
    expect(percentOf(8333)).toBe(83);
    expect(barWidth(null)).toBe(0);
    expect(barWidth(12_000)).toBe(100);
    expect(barWidth(-5)).toBe(0);
    expect(acceptTime(45)).toEqual({ unit: 'seconds', count: 45 });
    expect(acceptTime(119)).toEqual({ unit: 'seconds', count: 119 });
    expect(acceptTime(600)).toEqual({ unit: 'minutes', count: 10 });
    expect(ratingText(440)).toBe('4.4');
    expect(ratingText(null)).toBeNull();
  });

  it('application references and stages', () => {
    expect(APPLICATION_REF.test(normaliseRef(' pa-rpr-2026-abc234 '))).toBe(true);
    expect(APPLICATION_REF.test('PA-RPR-2026-ABC23')).toBe(false);
    expect(stageIndex('new')).toBe(0);
    expect(stageIndex('in_review')).toBe(1);
    expect(stageIndex('approved')).toBe(2);
  });
});
