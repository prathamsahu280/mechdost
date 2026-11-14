/**
 * Admin review of seller applications in the demo (plan 2026-11-13 Task 8): approval sets the delivery area
 * (user: "admin, at approval", pre-filled from the city's PIN codes), rejection needs a reason code, and a
 * second application with the same GSTIN is flagged. Mirrors `packages/db/src/repo/partner-applications.ts`.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { APPLICATION_STAGES, type DemoApplication } from '../src/demo/store';
import {
  applicationsWithSameGstin,
  approveApplication,
  createApplication,
  createInvite,
  defaultCoverage,
  rejectApplication,
} from '../src/demo/partner-store';

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

const seller = (
  gstNumber = '22ABVCS4888H1ZL',
): Omit<DemoApplication, 'code' | 'createdAt' | 'stage' | 'rejected'> => ({
  kind: 'seller',
  name: 'Ravi Sahu',
  phone: '9876543210',
  business: 'Sahu Auto Parts',
  pincode: '492004',
  vehicles: [],
  details: '',
  gstStatus: 'registered',
  gstNumber,
  productSlugs: ['castrol-activ-4t-20w40-900ml'],
  source: 'public',
});

const VERIFICATION = APPLICATION_STAGES.indexOf('verification');
const ONBOARDED = APPLICATION_STAGES.indexOf('onboarded');

beforeEach(() => {
  fakeWindow();
});

describe('seller application review', () => {
  it('the default delivery area is every city PIN with the standard charge and days', () => {
    const c = defaultCoverage();
    expect(c.pincodes).toEqual(expect.arrayContaining(['492001', '492004']));
    expect(c).toMatchObject({ shippingPaise: 4_000, leadDays: 2 });
  });

  it('approval needs at least one PIN and a valid charge and days, then onboards with that area', () => {
    const app = createApplication(seller());
    const read = () =>
      JSON.parse(window.localStorage.getItem('mechdost-demo-applications') ?? '[]') as DemoApplication[];
    expect(approveApplication(app.code, { pincodes: [], shippingPaise: 4_000, leadDays: 2 })).toBe(false);
    expect(approveApplication(app.code, { pincodes: ['49200'], shippingPaise: 4_000, leadDays: 2 })).toBe(
      false,
    );
    expect(approveApplication(app.code, { pincodes: ['492004'], shippingPaise: -1, leadDays: 2 })).toBe(
      false,
    );
    expect(approveApplication(app.code, { pincodes: ['492004'], shippingPaise: 4_000, leadDays: 15 })).toBe(
      false,
    );
    expect(read()[0]?.stage).toBe(0);
    expect(
      approveApplication(app.code, { pincodes: ['492004', '492001'], shippingPaise: 3_000, leadDays: 1 }),
    ).toBe(true);
    expect(read()[0]).toMatchObject({
      stage: ONBOARDED,
      coverage: { pincodes: ['492004', '492001'], shippingPaise: 3_000, leadDays: 1 },
    });
    expect(approveApplication(app.code, { pincodes: ['492004'], shippingPaise: 0, leadDays: 0 })).toBe(false);
    expect(VERIFICATION).toBeGreaterThan(0);
  });

  it('rejection needs a reason code and is final', () => {
    const app = createApplication(seller());
    expect(rejectApplication(app.code, 'nope' as never)).toBe(false);
    expect(rejectApplication(app.code, 'documents_invalid')).toBe(true);
    const stored = JSON.parse(
      window.localStorage.getItem('mechdost-demo-applications') ?? '[]',
    ) as DemoApplication[];
    expect(stored[0]).toMatchObject({ rejected: true, rejectReason: 'documents_invalid' });
    expect(approveApplication(app.code, defaultCoverage())).toBe(false);
  });

  it('flags other open applications with the same GSTIN', () => {
    const a = createApplication(seller());
    const b = createApplication(seller());
    createApplication(seller('27AAPFU0939F1ZV'));
    expect(applicationsWithSameGstin(b).map((x) => x.code)).toEqual([a.code]);
    rejectApplication(a.code, 'duplicate');
    expect(applicationsWithSameGstin(b)).toEqual([]);
  });

  it('an invited seller is approved on submit with the default delivery area', () => {
    const invite = createInvite({ name: 'Asha Verma', email: 'asha@example.com', phone: '9812345670' });
    const app = createApplication({ ...seller(), source: 'invite' }, invite.token);
    expect(app.stage).toBe(ONBOARDED);
    expect(app.coverage).toEqual(defaultCoverage());
  });
});
