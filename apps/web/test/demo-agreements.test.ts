/**
 * Seller agreement in the demo (plan 2026-11-13 Task 8; text from the user later, Q77): the admin publishes
 * versions in English and Hindi, a shop accepts the current version only, and a new version needs a new
 * acceptance. Mirrors `packages/db/src/repo/agreements.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptAgreement,
  currentAgreement,
  publishAgreement,
  shopAgreementStatus,
} from '../src/demo/agreements';

function fakeWindow() {
  const data = new Map<string, string>();
  Object.assign(globalThis, {
    window: {
      localStorage: {
        getItem: (k: string) => data.get(k) ?? null,
        setItem: (k: string, v: string) => {
          data.set(k, v);
        },
        removeItem: (k: string) => {
          data.delete(k);
        },
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    },
  });
}

const EN = 'The seller agrees to list genuine parts at prices approved by MechDost.';
const HI = 'विक्रेता MechDost द्वारा मंज़ूर कीमतों पर असली पुर्ज़े बेचने के लिए सहमत है।';

beforeEach(() => {
  fakeWindow();
});

describe('demo seller agreement', () => {
  it('needs both languages with at least 20 characters', () => {
    expect(publishAgreement({ textEn: 'too short', textHi: HI })).toEqual({
      error: 'AGREEMENT_TEXT_INVALID',
    });
    expect(publishAgreement({ textEn: EN, textHi: '  ' })).toEqual({ error: 'AGREEMENT_TEXT_INVALID' });
    expect(currentAgreement()).toBeNull();
  });

  it('publishes numbered versions; the newest is current', () => {
    expect(publishAgreement({ textEn: EN, textHi: HI })).toEqual({ version: 1 });
    expect(publishAgreement({ textEn: `${EN} Updated.`, textHi: HI })).toEqual({ version: 2 });
    expect(currentAgreement()?.version).toBe(2);
  });

  it('a shop accepts the current version only, and a new version asks again', () => {
    expect(shopAgreementStatus('sharma-auto-parts')).toEqual({ status: 'none' });
    publishAgreement({ textEn: EN, textHi: HI });
    expect(shopAgreementStatus('sharma-auto-parts')).toEqual({ status: 'to_accept', version: 1 });
    expect(acceptAgreement('sharma-auto-parts', 1)).toBe(true);
    expect(shopAgreementStatus('sharma-auto-parts')).toMatchObject({ status: 'accepted', version: 1 });
    publishAgreement({ textEn: `${EN} Updated.`, textHi: HI });
    expect(acceptAgreement('sharma-auto-parts', 1)).toBe(false);
    expect(shopAgreementStatus('sharma-auto-parts')).toEqual({ status: 'to_accept', version: 2 });
  });
});
