/**
 * DC-B3 / DC-P5 / DC-P8 (QA 2026-11-27): staff and riders saw raw keys (`delivery.errors.STALE`) or "Something went
 * wrong" for refusals the delivery API answers on purpose. Guard: every error code the delivery routes and the
 * delivery repositories can return has plain English and Hindi copy in `delivery.errors`, and the web maps it.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { DELIVERY_ERROR_CODES, deliveryErrorKey } from '../src/lib/delivery/view';

const root = new URL('../../../', import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, root), 'utf8');

/** Codes the screens answer with their own words (not `delivery.errors`). */
const GENERIC = new Set(['NOT_FOUND', 'VALIDATION', 'UNAVAILABLE']);

function apiCodes(): Set<string> {
  const codes = new Set<string>();
  const route = read('apps/api/src/routes/delivery.ts');
  for (const m of route.matchAll(/ApiError\(\s*\d+,\s*'([A-Z][A-Z_]+)'/g)) codes.add(m[1] ?? '');
  for (const m of route.matchAll(/errorBody\(\s*c,\s*'([A-Z][A-Z_]+)'/g)) codes.add(m[1] ?? '');
  const repoDir = new URL('packages/db/src/repo/', root);
  for (const f of readdirSync(repoDir).filter((n) => /^delivery-.*\.ts$/.test(n))) {
    const src = readFileSync(new URL(f, repoDir), 'utf8');
    // `new ConflictError('message', 'CODE')`, possibly over several lines; the code is the last quoted CAPS literal.
    for (const m of src.matchAll(
      /new (?:Conflict|NotFound|Forbidden|Validation|DailyCap)Error\(([\s\S]*?)\)/g,
    )) {
      const caps = [...(m[1] ?? '').matchAll(/'([A-Z][A-Z_]+)'/g)].map((x) => x[1] ?? '');
      const last = caps.at(-1);
      if (last) codes.add(last);
    }
  }
  for (const g of GENERIC) codes.delete(g);
  codes.delete('');
  return codes;
}

describe('every delivery API error code has words (DC-B3)', () => {
  const codes = [...apiCodes()].sort();

  it('finds the codes QA hit', () => {
    for (const c of [
      'STALE',
      'INVITE_OPEN',
      'AGENT_NOT_ELIGIBLE',
      'WRONG_CODE',
      'DOCUMENT_IN_USE',
      'JOB_REQUIRED',
    ])
      expect(codes).toContain(c);
  });

  it('the web maps each one', () => {
    expect(codes.filter((c) => deliveryErrorKey(c) === null)).toEqual([]);
  });

  it('English and Hindi copy exist for each mapped code', () => {
    const enErr = (en as { delivery: { errors: Record<string, string> } }).delivery.errors;
    const hiErr = (hi as { delivery: { errors: Record<string, string> } }).delivery.errors;
    for (const c of DELIVERY_ERROR_CODES) {
      expect(enErr[c], `en ${c}`).toBeTruthy();
      expect(hiErr[c], `hi ${c}`).toBeTruthy();
    }
  });

  it('the rider document form checks Aadhaar and format before sending (DC-P5)', () => {
    const src = read('apps/web/src/components/delivery/agent-profile.tsx');
    expect(src).toContain('documentNumberProblem(kind');
    expect(src).toContain("'DOCUMENT_AADHAAR'");
  });

  it('the staff screens never print a raw key', () => {
    const src = read('apps/web/src/components/delivery/admin-delivery.tsx');
    expect(src).not.toMatch(/e\(code as 'JOB_CHANGED'/);
  });
});
