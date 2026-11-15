/**
 * Typed fixtures of the catalogue tier 2 audit rows (design 2026-11-15 items 4, 6, 7): Account -> Privacy (consents,
 * data download), "Notify me" under an address in a PIN the service does not cover, Admin -> Catalogue "goes well
 * with" rules, Admin -> Settings "waiting for a PIN code". Every body carries its shared schema, so a fixture that
 * drifts from the API contract fails the case. The recommendation slots on the product page and in the cart are
 * Server Components that call the API from the server; the browser harness cannot see those calls, so they are covered
 * by the API and repository tests instead.
 */
import { AddressesDto } from '@mechdost/shared/account-api';
import { PrivacyViewDto, ConsentListDto, ExportStatusDto } from '@mechdost/shared/privacy-api';
import { RecoCategoryListDto, RecoRuleListDto } from '@mechdost/shared/recommendations';
import { WaitlistDemandDto, WaitlistEntryDto, WaitlistListDto } from '@mechdost/shared/waitlist';
import { AdminProductList } from '@mechdost/shared/admin-catalogue';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

const NOW = Date.parse('2026-11-15T10:00:00.000Z');
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const long = (c: AuditCase) => c.state.stress === 'long-text';

const me = (c: AuditCase): Mock => ({
  method: 'GET',
  path: /^\/me$/,
  reply: (): Reply => ({
    body: {
      name: 'Audit User',
      phone: '+919876543210',
      email: 'audit@example.com',
      emailVerified: true,
      language: c.locale,
      version: 1,
      roles:
        c.auth === 'admin'
          ? [{ role: 'super_admin', shopId: null, workshopId: null }]
          : [{ role: 'customer', shopId: null, workshopId: null }],
    },
  }),
});

// ── Account -> Privacy ─────────────────────────────────────────────────────────────────────────────────────────

function privacyView(c: AuditCase): Dto<typeof PrivacyViewDto> {
  const consent = c.state.consent ?? 'never';
  const exp = (c.state.export ?? 'none') as 'none' | 'requested' | 'ready' | 'expired' | 'failed';
  const exportRow = (status: 'requested' | 'ready' | 'expired' | 'failed'): Dto<typeof ExportStatusDto> => ({
    id: uuid(700),
    status,
    requestedAt: iso(-30),
    readyAt: status === 'ready' || status === 'expired' ? iso(-28) : null,
    expiresAt: status === 'ready' ? iso(60 * 23) : status === 'expired' ? iso(-5) : null,
    bytes: status === 'ready' ? 4210 : null,
  });
  const row = (purpose: 'marketing' | 'analytics', granted: boolean | null) => ({
    purpose,
    granted,
    at: granted === null ? null : iso(-60 * 24 * 3),
    noticeVersion: granted === null ? null : '2026-11-15',
  });
  const granted = consent === 'never' ? null : consent === 'allowed';
  return {
    consents: [row('marketing', granted), row('analytics', consent === 'allowed' ? true : granted)],
    export: exp === 'none' ? null : exportRow(exp),
    canRequestExport: exp === 'none' || exp === 'failed',
  };
}

export function privacyMocks(c: AuditCase): Mock[] {
  return [
    me(c),
    {
      method: 'GET',
      path: /^\/me\/privacy$/,
      schema: PrivacyViewDto,
      reply: (): Reply =>
        c.state.consent === 'error' ? { status: 500, code: 'INTERNAL' } : { body: privacyView(c) },
    },
    {
      method: 'PUT',
      path: /^\/me\/privacy\/consents\/(marketing|analytics)$/,
      schema: ConsentListDto,
      reply: (): Reply => ({ body: { consents: privacyView(c).consents } }),
    },
    {
      method: 'POST',
      path: /^\/me\/data-exports$/,
      schema: ExportStatusDto,
      reply: (): Reply => ({
        status: 202,
        body: {
          id: uuid(700),
          status: 'requested',
          requestedAt: iso(0),
          readyAt: null,
          expiresAt: null,
          bytes: null,
        },
      }),
    },
  ];
}

// ── "Notify me" under an unserved address ──────────────────────────────────────────────────────────────────────

export function notifyMeMocks(c: AuditCase): Mock[] {
  const wait = c.state.waitlist ?? 'none';
  const entry = (status: 'waiting' | 'notified'): Dto<typeof WaitlistEntryDto> => ({
    pincode: '492099',
    status,
    createdAt: iso(-60),
    notifiedAt: status === 'notified' ? iso(-5) : null,
  });
  return [
    me(c),
    {
      method: 'GET',
      path: /^\/me\/addresses$/,
      schema: AddressesDto,
      reply: (): Reply => ({
        body: {
          addresses: [
            {
              id: uuid(710),
              label: 'home',
              contactName: long(c) ? 'Ramesh Kumar Chandrakar Shrivastava' : 'Ravi Sahu',
              contactPhone: '+919876543210',
              line1: long(c)
                ? 'House 12, Gali 4, Beside the old water tank, Telibandha Main Road'
                : 'House 12, Pandri',
              line2: null,
              landmark: null,
              pincode: '492099',
              cityName: null,
              stateName: c.locale === 'hi' ? 'छत्तीसगढ़' : 'Chhattisgarh',
              lat: null,
              lng: null,
              isDefaultShipping: true,
              isDefaultBilling: false,
              serviceable: false,
              version: 1,
            },
          ],
        } satisfies Dto<typeof AddressesDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/me\/vehicles$/,
      reply: (): Reply => ({ body: { vehicles: [] } }),
    },
    {
      method: 'GET',
      path: /^\/me\/pincode-waitlist$/,
      schema: WaitlistListDto,
      reply: (): Reply => ({ body: { entries: wait === 'waiting' ? [entry('waiting')] : [] } }),
    },
    {
      method: 'POST',
      path: /^\/me\/pincode-waitlist$/,
      schema: WaitlistEntryDto,
      reply: (): Reply =>
        wait === 'full'
          ? { status: 422, code: 'WAITLIST_FULL' }
          : wait === 'error'
            ? { status: 500, code: 'INTERNAL' }
            : { status: 201, body: entry('waiting') },
    },
    {
      method: 'DELETE',
      path: /^\/me\/pincode-waitlist\/\d{6}$/,
      reply: (): Reply => ({ body: { removed: true } }),
    },
  ];
}

// ── Admin -> Catalogue: "goes well with" rules ─────────────────────────────────────────────────────────────────

export function adminRecoMocks(c: AuditCase): Mock[] {
  const mode = c.state.rules ?? 'few';
  const cat = (n: number, slug: string, name: string, nameHi: string) => ({
    id: uuid(720 + n),
    slug,
    name,
    nameHi,
  });
  const first = cat(1, 'lubricants', 'Lubricants', 'लुब्रिकेंट');
  const cats = [
    first,
    cat(2, 'filters', 'Filters', 'फ़िल्टर'),
    cat(3, 'batteries', 'Batteries', 'बैटरी'),
    cat(4, 'tyres', 'Tyres', 'टायर'),
  ];
  const rule = (i: number, over: Record<string, unknown> = {}) => ({
    id: uuid(740 + i),
    triggerCategory: cats[i % 4] ?? first,
    suggestCategory: cats[(i + 1) % 4] ?? first,
    label: long(c)
      ? 'Goes well with your engine oil: fresh filter, fresh oil, a smoother ride all the way home'
      : 'Goes well with your oil',
    labelHi: long(c)
      ? 'आपके इंजन ऑयल के साथ बढ़िया चलता है: नया फ़िल्टर, नया ऑयल, घर तक आसान सफ़र'
      : 'आपके ऑयल के साथ अच्छा चलता है',
    priority: 5 + i,
    active: true,
    version: 1,
    updatedAt: iso(-60),
    ...over,
  });
  return [
    me(c),
    {
      method: 'GET',
      path: /^\/admin\/recommendation-rules$/,
      schema: RecoRuleListDto,
      reply: (): Reply => {
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        const n = mode === 'none' ? 0 : mode === 'many' ? 12 : 3;
        return {
          body: {
            rules: Array.from({ length: n }, (_, i) =>
              rule(i, mode === 'paused' && i === 0 ? { active: false } : {}),
            ),
          } satisfies Dto<typeof RecoRuleListDto>,
        };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/recommendation-categories$/,
      schema: RecoCategoryListDto,
      reply: (): Reply => ({ body: { categories: cats } }),
    },
    {
      method: 'POST',
      path: /^\/admin\/recommendation-rules$/,
      reply: (): Reply => ({ status: 201, body: rule(0) }),
    },
    // The catalogue editor above the rules loads its product list.
    {
      method: 'GET',
      path: /^\/admin\/catalogue\/products$/,
      schema: AdminProductList,
      reply: (): Reply => ({ body: { items: [], next: null } }),
    },
  ];
}

// ── Admin -> Settings: waiting for a PIN code ──────────────────────────────────────────────────────────────────

export function demandMocks(c: AuditCase): Mock[] {
  const mode = c.state.demand ?? 'few';
  const row = (i: number) => ({
    pincode: String(492100 + i),
    cityCode: i % 3 === 2 ? null : 'RPR',
    area: i % 3 === 2 ? null : long(c) ? 'Shankar Nagar Extension, Telibandha Main Road' : 'Pandri',
    areaHi: i % 3 === 2 ? null : long(c) ? 'शंकर नगर एक्सटेंशन, तेलीबांधा मेन रोड' : 'पंडरी',
    waiting: 12 - i,
    notified: i,
    servedNow: i === 1,
    oldestAt: iso(-60 * 24 * (i + 1)),
  });
  return [
    {
      method: 'GET',
      path: /^\/admin\/pincode-waitlist$/,
      schema: WaitlistDemandDto,
      reply: (): Reply => {
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        const n = mode === 'none' ? 0 : mode === 'many' ? 10 : 4;
        const rows = Array.from({ length: n }, (_, i) => row(i));
        return {
          body: { rows, totalWaiting: rows.reduce((s, r) => s + r.waiting, 0) } satisfies Dto<
            typeof WaitlistDemandDto
          >,
        };
      },
    },
  ];
}
