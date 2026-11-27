/**
 * Delivery + COD QA fixes, 2026-11-27 night batch (docs/qa/qa-backlog-2026-11-27.md). One block per backlog id.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import en from '@mechdost/shared/i18n/en.json';
import hi from '@mechdost/shared/i18n/hi.json';
import { foldAttemptsLeft, wrongCodeLeft } from '../src/lib/delivery/view';
import { riskOfChange } from '../src/lib/admin-settings-registry';
import { shopStageKey } from '../src/lib/order-views';

type Ns = Record<string, Record<string, string>>;

describe('DC-P13 shop return hand-back', () => {
  it('folds the API attemptsLeft detail into the code so the screen can say how many tries are left', () => {
    expect(foldAttemptsLeft('WRONG_CODE', { attemptsLeft: 2 })).toBe('WRONG_CODE:2');
    expect(wrongCodeLeft(foldAttemptsLeft('WRONG_CODE', { attemptsLeft: 2 }))).toBe(2);
    expect(foldAttemptsLeft('WRONG_CODE', undefined)).toBe('WRONG_CODE');
    expect(foldAttemptsLeft('STALE', { attemptsLeft: 2 })).toBe('STALE');
  });

  it('labels ready-for-pickup and returned orders in words, never "Confirmed — will be shipped"', () => {
    expect(shopStageKey('ready_for_pickup')).toBe('stage_ready_for_pickup');
    expect(shopStageKey('returned')).toBe('stage_returned');
    for (const m of [en, hi] as unknown as Ns[]) {
      expect(m.order?.stage_ready_for_pickup).toBeTruthy();
      expect(m.order?.stage_returned).toBeTruthy();
    }
  });
});

const src = (p: string) => readFileSync(p, 'utf8');

describe('DC-F4 city-wide delivery switch', () => {
  it('asks before delivery agents are switched on (or off) for a city, with en and hi words', () => {
    expect(riskOfChange('delivery.agents_enabled', false, true)).toBe('risk_agentsOn');
    expect(riskOfChange('delivery.agents_enabled', true, false)).toBe('risk_agentsOff');
    expect(riskOfChange('delivery.agents_enabled', null, true)).toBe('risk_agentsOn');
    for (const m of [en, hi] as unknown as Ns[]) {
      expect(m.adminSettings?.risk_agentsOn).toBeTruthy();
      expect(m.adminSettings?.risk_agentsOff).toBeTruthy();
    }
  });
});

describe('DC-P1 partner status timeline', () => {
  it('names the current step "Current step", not the stage again ("Received (Received)")', () => {
    const s = src('src/components/partners/partner-status.tsx');
    expect(s).not.toMatch(/currentLabel=\{t\(`stage_/);
    expect(s).toMatch(/currentLabel=\{t\('statusCurrent'\)\}/);
    for (const m of [en, hi] as unknown as Ns[]) expect(m.shopTier2?.statusCurrent).toBeTruthy();
  });
});
