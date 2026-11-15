/**
 * Order and request threads on the website (design 2026-11-15, items 1 to 3): every API code the thread screens can
 * show reads as a translated message in both languages, the rupee parser is exact, the shared answer shapes accept
 * both the old and the new API answer, and the new screens stay out of the header, layout and shop bundles (JS budget:
 * they are reached only through the support screens, which load on demand).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SupportTicket } from '@mechdost/shared/support-api';
import {
  ORDER_ISSUE_CODES,
  SERVICE_ISSUE_CODES,
  SUPPORT_ISSUE_CODES,
  SUPPORT_THREAD_ERROR_CODES,
} from '@mechdost/shared/support-thread';
import { photoProblem, threadErrorKey } from '../src/lib/support-thread-api';
import { rupeesTextToPaise } from '../src/lib/support-view';
import en from '../../../packages/shared/src/i18n/en.json';
import hi from '../../../packages/shared/src/i18n/hi.json';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('thread messages', () => {
  const extra = [
    'RATE_LIMITED',
    'HTTP_429',
    'HTTP_413',
    'NOT_FOUND',
    'TICKET_CLOSED',
    'TICKET_DAILY_LIMIT',
    'REPLY_LIMIT',
    'DESTINATION_LOCKED',
    'ENCRYPTION_UNAVAILABLE',
    'REFUND_NOT_COLLECTED',
    'REFUND_EXCEEDS_ORDER',
    'FORBIDDEN',
    'TICKET_BODY_EMPTY',
    'NETWORK',
    'weird',
  ];

  it('maps every code to a message that exists in English and Hindi', () => {
    for (const code of [...SUPPORT_THREAD_ERROR_CODES, ...extra]) {
      const key = threadErrorKey(code) as keyof typeof en.supportThread;
      expect(en.supportThread[key], code).toBeTruthy();
      expect(hi.supportThread[key], code).toBeTruthy();
    }
  });

  it('has a label for every issue code in both languages, and the same keys in both', () => {
    for (const code of SUPPORT_ISSUE_CODES) {
      const key = `issue_${code}` as keyof typeof en.supportThread;
      expect(en.supportThread[key], code).toBeTruthy();
      expect(hi.supportThread[key], code).toBeTruthy();
    }
    expect(Object.keys(hi.supportThread).sort()).toEqual(Object.keys(en.supportThread).sort());
  });

  it('offers only issue codes that fit the subject', () => {
    expect(ORDER_ISSUE_CODES).not.toContain('workshop_issue');
    expect(SERVICE_ISSUE_CODES).not.toContain('wrong_part');
    for (const code of [...ORDER_ISSUE_CODES, ...SERVICE_ISSUE_CODES])
      expect(SUPPORT_ISSUE_CODES).toContain(code);
  });

  it('checks photo count and size before any request', () => {
    const small = new File([new Uint8Array(10)], 'a.jpg');
    expect(photoProblem([small, small, small, small])).toBeNull();
    expect(photoProblem([small, small, small, small, small])).toBe('ATTACHMENT_LIMIT');
    const big = new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'big.jpg');
    expect(photoProblem([big])).toBe('PHOTO_TOO_LARGE');
  });
});

describe('rupee amounts', () => {
  it('turns typed rupees into exact paise without floats', () => {
    expect(rupeesTextToPaise('499')).toBe(49_900);
    expect(rupeesTextToPaise('499.5')).toBe(49_950);
    expect(rupeesTextToPaise('₹1,299.05')).toBe(129_905);
    expect(rupeesTextToPaise('0.10')).toBe(10);
    expect(rupeesTextToPaise('0')).toBeNull();
    expect(rupeesTextToPaise('')).toBeNull();
    expect(rupeesTextToPaise('12.345')).toBeNull();
    expect(rupeesTextToPaise('-5')).toBeNull();
    expect(rupeesTextToPaise('abc')).toBeNull();
    expect(rupeesTextToPaise('1000001')).toBeNull();
  });
});

describe('answer shapes', () => {
  const base = {
    code: 'REQ-RPR-2026-7K3Q9X',
    kind: 'order_issue',
    status: 'open',
    channel: 'web',
    orderCode: null,
    slaAckDue: '2026-11-17T00:00:00.000Z',
    slaResolveDue: '2026-12-15T00:00:00.000Z',
    resolvedAt: null,
    createdAt: '2026-11-15T00:00:00.000Z',
    version: 1,
    messages: [
      {
        id: 'm1',
        role: 'customer',
        body: 'Hi',
        internal: false,
        channel: 'web',
        createdAt: '2026-11-15T00:00:00.000Z',
      },
    ],
  };

  it('accepts an older answer (no thread fields) and a newer one with photos and a masked destination', () => {
    const old = SupportTicket.parse(base);
    expect(old.issueCode).toBeNull();
    expect(old.refund).toEqual({ eligible: false, destination: null });
    expect(old.messages[0]?.attachments).toEqual([]);
    const fresh = SupportTicket.parse({
      ...base,
      issueCode: 'damaged',
      serviceCode: null,
      refund: { eligible: true, destination: { kind: 'upi', masked: 'ra***@okhdfcbank' } },
      messages: [
        {
          ...base.messages[0],
          attachments: [
            {
              id: 'a',
              width: 10,
              height: 10,
              thumbUrl: '/support-photos/a/thumb?e=1&s=x',
              largeUrl: '/support-photos/a/large?e=1&s=x',
            },
          ],
        },
      ],
    });
    expect(fresh.refund.destination?.masked).toBe('ra***@okhdfcbank');
    expect(fresh.messages[0]?.attachments).toHaveLength(1);
  });

  it('reads an issue code this build does not know as none, never a failure', () => {
    expect(SupportTicket.parse({ ...base, issueCode: 'brand_new_code' }).issueCode).toBeNull();
  });
});

describe('import graph (JS budget)', () => {
  const screens = ['thread-opener-api', 'refund-destination-api', 'staff-refund-api'];

  it('the header, layout and shop pages never reach the thread screens or their client', () => {
    for (const file of [
      '../src/components/site/header.tsx',
      '../src/app/[locale]/layout.tsx',
      '../src/components/portal/shop-portal-api.tsx',
    ]) {
      const src = (() => {
        try {
          return read(file);
        } catch {
          return '';
        }
      })();
      expect(src, file).not.toMatch(/thread-opener|refund-destination|staff-refund|support-thread-api/);
    }
  });

  it('only the two real-mode support screens import them, and those load on demand', () => {
    const importers = [
      '../src/components/account/support-section-api.tsx',
      '../src/components/portal/admin-support-api.tsx',
    ];
    expect(read(importers[0] ?? '')).toMatch(/support\/thread-opener-api/);
    expect(read(importers[1] ?? '')).toMatch(/support\/staff-refund-api/);
    // the demo screens (account and admin) never mention them
    for (const file of [
      '../src/components/account/support-section.tsx',
      '../src/components/portal/admin-support.tsx',
    ]) {
      expect(read(file), file).not.toMatch(
        /thread-opener|refund-destination|staff-refund|support-thread-api/,
      );
    }
    expect(read('../src/components/account/support-section.tsx')).toMatch(
      /dynamic\(\(\) => import\('\.\/support-section-api'\)/,
    );
    expect(read('../src/components/portal/admin-support.tsx')).toMatch(/dynamic\(/);
  });

  it('the screens hold no storage address and never show a typed payout value back', () => {
    for (const name of screens) {
      const src = read(`../src/components/support/${name}.tsx`);
      expect(src, name).not.toMatch(/supabase|storage\/v1|SECRET/i);
    }
    const dest = read('../src/components/support/refund-destination-api.tsx');
    // the typed values are cleared after a save and the display uses only the API's masked text
    expect(dest).toContain("setUpiId('')");
    expect(dest).toContain('refund.destination.masked');
  });
});
