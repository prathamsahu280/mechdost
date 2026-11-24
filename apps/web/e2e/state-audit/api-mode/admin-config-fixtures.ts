/**
 * Typed fixtures of the admin configuration audit rows (design 2026-11-15 items 5 to 8): the policy page editor
 * (Admin -> Content), the home layout editor (Admin -> Home layout), and company details with the city picker and
 * per-city setting overrides (Admin -> Settings). Kept apart from `fixtures.ts`; its registry hands the matching cases
 * here. Every value is typed with the shared DTO and every mock carries its schema.
 */
import {
  AdminCityList,
  AdminCompany,
  AdminContentList,
  AdminHomeLayout,
  AdminSettingList,
  PolicyVersionList,
} from '@mechdost/shared/admin-config-api';
import { AdminPincodeList } from '@mechdost/shared/geo-api';
import { OPERATIONAL_SETTINGS, SETTING_KEYS } from '@mechdost/shared/settings';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';

const NOW = Date.parse('2026-11-15T10:00:00.000Z');
const iso = (offsetMin: number) => new Date(NOW + offsetMin * 60_000).toISOString();

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

const LONG_EN =
  'Sharma Auto Parts and Genuine Lubricants Wholesale Dealers, Telibandha Main Road Opposite Marine Drive Raipur';
const LONG_HI =
  'शर्मा ऑटो पार्ट्स एंड जेनुइन लुब्रिकेंट्स होलसेल डीलर्स, तेलीबांधा मेन रोड, मरीन ड्राइव के सामने, रायपुर छत्तीसगढ़';
const loc = (c: AuditCase) => (c.locale === 'hi' ? LONG_HI : LONG_EN);
const long = (c: AuditCase) => c.state.stress === 'long-text';

const CITIES: Dto<typeof AdminCityList> = { cities: [{ code: 'RPR', name: 'Raipur', nameHi: 'रायपुर' }] };
const citiesMock = (): Mock => ({
  method: 'GET',
  path: /^\/admin\/settings\/cities$/,
  schema: AdminCityList,
  reply: (): Reply => ({ body: CITIES }),
});

// ── Policy pages ────────────────────────────────────────────────────────────────────────────────────────────────

function policyDoc(c: AuditCase, locale: 'en' | 'hi', title: string) {
  const text = long(c)
    ? `${loc(c)} ${loc(c)}`
    : locale === 'hi'
      ? 'हम आपकी जानकारी सुरक्षित रखते हैं।'
      : 'We keep your details safe.';
  return {
    title,
    lead: long(c) ? loc(c) : locale === 'hi' ? 'सरल भाषा में।' : 'In plain words.',
    updatedOn: '2026-11-10',
    sections: [
      { heading: locale === 'hi' ? 'हम कौन हैं' : 'Who we are', body: '{company}, {address}', emoji: '🏢' },
      { heading: locale === 'hi' ? 'आपकी जानकारी' : 'Your details', body: text },
    ],
  };
}

/** Admin -> Content: the policy pages (none published, published, a draft waiting, long text, load error). */
export function policyMocks(c: AuditCase): Mock[] {
  const mode = c.state.policies ?? 'none';
  return [
    {
      method: 'GET',
      path: /^\/admin\/content$/,
      schema: AdminContentList,
      reply: (): Reply => {
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        if (mode === 'none') return { body: { entries: [] } satisfies Dto<typeof AdminContentList> };
        return {
          body: {
            entries: (['en', 'hi'] as const).map((locale) => ({
              key: 'policy.privacy',
              locale,
              draft: mode === 'draft' ? { value: policyDoc(c, locale, 'Draft title'), version: 4 } : null,
              published: {
                value: policyDoc(c, locale, locale === 'hi' ? 'गोपनीयता सूचना' : 'Privacy notice'),
                version: 3,
                publishedAt: iso(-1440),
              },
            })),
          } satisfies Dto<typeof AdminContentList>,
        };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/content\/policy\.[a-z]+\/(en|hi)\/versions$/,
      schema: PolicyVersionList,
      reply: (): Reply => ({
        body: {
          versions:
            mode === 'none' || mode === 'error'
              ? []
              : [
                  {
                    versionNo: 3,
                    action: 'restored',
                    restoredFrom: 1,
                    value: policyDoc(c, c.locale, 'Privacy notice'),
                    createdAt: iso(-1440),
                    by: long(c) ? loc(c) : 'Asha Rao',
                  },
                  {
                    versionNo: 2,
                    action: 'published',
                    restoredFrom: null,
                    value: policyDoc(c, c.locale, 'Privacy notice'),
                    createdAt: iso(-4320),
                    by: 'Asha Rao',
                  },
                  {
                    versionNo: 1,
                    action: 'published',
                    restoredFrom: null,
                    value: policyDoc(c, c.locale, 'Privacy notice'),
                    createdAt: iso(-10_080),
                    by: null,
                  },
                ],
        } satisfies Dto<typeof PolicyVersionList>,
      }),
    },
  ];
}

// ── Home layout ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Admin -> Home layout: nothing saved yet (the default), a saved custom layout, or a load error. */
export function layoutMocks(c: AuditCase): Mock[] {
  const mode = c.state.layout ?? 'default';
  return [
    citiesMock(),
    {
      method: 'GET',
      path: /^\/admin\/site\/layout$/,
      schema: AdminHomeLayout,
      reply: (): Reply => {
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        const custom = mode === 'custom';
        return {
          body: {
            layout: {
              order: custom
                ? [
                    'faq',
                    'roadside',
                    'audiences',
                    'trust',
                    'categories',
                    'products',
                    'route',
                    'service',
                    'workshops',
                    'partners',
                  ]
                : [
                    'roadside',
                    'audiences',
                    'trust',
                    'categories',
                    'products',
                    'route',
                    'service',
                    'workshops',
                    'faq',
                    'partners',
                  ],
              hidden: custom ? ['partners'] : [],
              featured: custom ? ['tyres', 'filters', 'batteries', 'evEssentials'] : null,
              emoji: custom ? { tyres: '🛞' } : {},
              mapDefault: custom ? 'map' : 'satellite',
            },
            version: custom ? 2 : null,
            inherited: false,
          } satisfies Dto<typeof AdminHomeLayout>,
        };
      },
    },
  ];
}

// ── Settings: city picker, per-city overrides, company details ─────────────────────────────────────────────────

/**
 * Admin -> Settings: a few settings (one site-wide), the city picker with inherited or overridden values, the PIN
 * list under it, and the company details (empty, filled, long text, load error).
 */
export function settingsMocks(c: AuditCase): Mock[] {
  const company = c.state.company ?? 'empty';
  const cityMode = c.state.city ?? 'all';
  const filled = company === 'filled' || company === 'long';
  const text = (en: string) => (company === 'long' ? loc(c) : en);
  return [
    citiesMock(),
    {
      method: 'GET',
      path: /^\/admin\/settings$/,
      schema: AdminSettingList,
      reply: ({ query }): Reply => {
        const forCity = query.get('city') !== null;
        const overridden = forCity && cityMode === 'overridden';
        return {
          body: {
            // The real API lists every key of the registry with its default; four carry values of their own.
            settings: SETTING_KEYS.map((key) => {
              const spec = OPERATIONAL_SETTINGS[key];
              const base = { key, default: spec.default, global: null, city: null, effective: spec.default };
              if (key === 'orders.acceptance_timeout_min')
                return {
                  ...base,
                  global: { value: 20, version: 2 },
                  city: overridden ? { value: 30, version: 1 } : null,
                  effective: overridden ? 30 : 20,
                };
              if (key === 'orders.customer_self_cancel_cod')
                return {
                  ...base,
                  city: overridden ? { value: true, version: 1 } : null,
                  effective: overridden,
                };
              return base;
            }),
          } satisfies Dto<typeof AdminSettingList>,
        };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/pincodes$/,
      schema: AdminPincodeList,
      reply: (): Reply => ({
        body: {
          city: { code: 'RPR', name: 'Raipur', nameHi: 'रायपुर' },
          pincodes: [
            {
              pincode: '492001',
              areaEn: 'Raipur Centre',
              areaHi: 'रायपुर केंद्र',
              lat: 21.25,
              lng: 81.63,
              active: true,
              inactiveReason: null,
              inactiveNote: null,
              source: 'admin',
              freeDeliveryMinPaise: null,
              shopsCovering: 2,
              version: 1,
              updatedAt: iso(-100),
            },
          ],
        } satisfies Dto<typeof AdminPincodeList>,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/company$/,
      schema: AdminCompany,
      reply: (): Reply => {
        if (company === 'error') return { status: 500, code: 'INTERNAL' };
        return {
          body: {
            details: filled
              ? {
                  legalName: text('Shourya Integrated Services Pvt Ltd'),
                  legalNameHi: text('शौर्य इंटीग्रेटेड सर्विसेज़ प्राइवेट लिमिटेड'),
                  cin: 'U74999CT2020PTC012345',
                  gstin: '22ABVCS4888H1ZL',
                  registeredAddress: text('C-605 Salasar Greens, Sarona, Tatibandh, Raipur 492099'),
                  registeredAddressHi: text('C-605 सालासर ग्रीन्स, सरोना, टाटीबंध, रायपुर 492099'),
                  grievanceName: text('Asha Rao'),
                  grievanceNameHi: text('आशा राव'),
                  grievanceEmail: 'grievance@mechdost.com',
                  grievancePhone: '+917978776551',
                }
              : {},
            version: filled ? 3 : null,
          } satisfies Dto<typeof AdminCompany>,
        };
      },
    },
  ];
}
