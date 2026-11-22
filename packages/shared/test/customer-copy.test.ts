import { describe, expect, it } from 'vitest';
import en from '../src/i18n/en.json';
import hi from '../src/i18n/hi.json';

/**
 * Two copy rulings (user, 2026-11-22; docs/decisions.md):
 *  A. Customers never see that an order is fulfilled through a shop/seller: no "verified shop", "nearby shop",
 *     "Sold by", "seller" ... on customer surfaces. Shop wording stays in the shop/workshop portals, admin,
 *     partner pages and the legal pages that must name the seller.
 *  B. Coverage copy says Chhattisgarh, not Raipur (`{region}` from `site.defaultRegion`); `{city}` stays only
 *     where it means a real city (admin tools, saved addresses).
 */
interface Tree {
  [key: string]: string | Tree;
}

function leaves(tree: Tree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [k, v] of leaves(value, path)) out.set(k, v);
  }
  return out;
}

/** Namespaces (or key prefixes) a customer can read. Everything else is portal, admin or partner copy. */
const CUSTOMER_PREFIXES = [
  'meta.',
  'seo.',
  'announcement.',
  'nav.',
  'tabs.',
  'home.',
  'footer.',
  'whatsapp.',
  'pages.',
  'product.',
  'assistant.',
  'catalogue.',
  'compare.',
  'cart.',
  'checkout.',
  'order.',
  'finder.',
  'workshop.',
  'request.',
  'reviews.',
  'quote.',
  'account.',
  'policies.',
  'refunds.',
  'support.',
  'supportThread.',
  'supportGuest.',
  'offers.',
  'trust.',
  'notify.order_',
  'notify.payment_',
  'notify.refund_',
  'notify.service_',
  'notify.quote_',
  'notify.ticket_',
];

/**
 * Keys inside those prefixes that are NOT customer copy, or are allowed to name a shop/seller.
 * Each exception has a reason; add one only with a decisions entry.
 */
const EXEMPT_PREFIXES: Record<string, string> = {
  'pages.partners.': 'partner page: aimed at shops and sellers',
  'seo.partners': 'partner page SEO: aimed at shops and sellers',
  'assistant.a_partner': 'answer about applying as a partner',
  'assistant.s_partner': 'partner suggestion',
  'quote.api_admin_': 'admin console of bulk quotes',
  'workshop.api_admin_': 'admin console',
  'trust.clauseHelp': 'admin: seller agreement clause help',
  'trust.lineLabel_': 'admin editor labels',
  'trust.partner': 'partner pages: sell genuine parts',
  'whatsapp.seller': 'partner application message',
  // Legal pages that must name the seller (Consumer Protection (E-Commerce) Rules, DPDP data recipients).
  'policies.terms.whoBody': 'legal: seller details are on the bill',
  'policies.terms.partnersTitle': 'legal: terms for shops and workshops',
  'policies.terms.partnersBody': 'legal: seller and workshop agreement',
  'policies.privacy.shareBody': 'legal (DPDP): who receives your data',
};

/** Hindi "shop" words that are not about fulfilment: the storefront ("दुकान" = the shop), or the buyer's own shop. */
const HINDI_STOREFRONT_OK = new Set([
  'compare.emptyAction', // "add products from the shop" (the storefront)
  'seo.bulkDescription', // "for a garage, fleet or shop" (the buyer's own business)
  'account.labelHint', // address label "Home, Office, Shop"
  'account.shopParts',
  'account.shopNow',
  'account.coinsShop',
]);

const FORBIDDEN_EN = [
  /\b(verified|nearby|local|real|independent)\s+(shops?|sellers?)\b/i,
  /\b(a|an|another|every|each|any|your|nearest)\s+(shops?|sellers?)\b/i,
  /\bthe shops? (accept|pack|confirm|decline|near)/i,
  /\bshops? (near|that|accept)/i,
  /\bsold by\b|\bfulfilled by\b|\bsellers?\b/i,
];
const FORBIDDEN_HI = /दुकान|विक्रेता|(?<!बेस्ट)सेलर/; // बेस्टसेलर (bestseller) is fine

const exempt = (key: string) => Object.keys(EXEMPT_PREFIXES).some((p) => key.startsWith(p));
const customerKeys = (all: Map<string, string>) =>
  [...all.keys()].filter((k) => CUSTOMER_PREFIXES.some((p) => k.startsWith(p)) && !exempt(k));

describe('ruling A: no shop or seller on customer surfaces', () => {
  const enLeaves = leaves(en);
  const hiLeaves = leaves(hi);

  it('has no shop/seller wording in customer English copy', () => {
    for (const key of customerKeys(enLeaves)) {
      const text = enLeaves.get(key) ?? '';
      for (const re of FORBIDDEN_EN) expect(text, `${key} matches ${String(re)}`).not.toMatch(re);
    }
  });

  it('has no shop/seller wording in customer Hindi copy', () => {
    for (const key of customerKeys(hiLeaves)) {
      if (HINDI_STOREFRONT_OK.has(key)) continue;
      expect(hiLeaves.get(key) ?? '', key).not.toMatch(FORBIDDEN_HI);
    }
  });

  it('keeps the removed keys out of the files', () => {
    for (const key of ['catalogue.soldBy', 'order.shopLabel', 'offers.shopOffer', 'coupons.cond_shop']) {
      expect(enLeaves.has(key), key).toBe(false);
      expect(hiLeaves.has(key), key).toBe(false);
    }
  });

  it('labels the routing stage as confirming availability, never a shop', () => {
    expect(en.order.stage_routing).toBe('Confirming availability');
    expect(hi.order.stage_routing).not.toMatch(FORBIDDEN_HI);
  });
});

describe('ruling B: coverage copy says Chhattisgarh', () => {
  it('has a regions namespace in both languages', () => {
    expect(en.regions.chhattisgarh).toBe('Chhattisgarh');
    expect(hi.regions.chhattisgarh).toBe('छत्तीसगढ़');
  });

  it('uses {region}, not {city}, in the coverage copy', () => {
    const keys = [
      'meta.title',
      'meta.description',
      'seo.shopTitle',
      'seo.categoryTitle',
      'seo.productTitle',
      'seo.workshopsTitle',
      'seo.workshopsDescription',
      'seo.partnersTitle',
      'seo.businessGaragesTitle',
      'seo.businessFleetsTitle',
      'seo.bulkTitle',
      'announcement.workshops',
      'home.hero.lead',
      'home.service.note',
      'home.workshops.eyebrow',
      'whatsapp.workshop',
      'pages.workshops.emptyTitle',
      'workshop.api_homeEmpty',
      'trust.homeGenuine',
      'trust.emailFooter',
    ];
    const enLeaves = leaves(en);
    const hiLeaves = leaves(hi);
    for (const key of keys) {
      expect(enLeaves.get(key), key).toContain('{region}');
      expect(hiLeaves.get(key), key).toContain('{region}');
    }
  });

  it('no customer-facing English or Hindi copy names Raipur as the area we cover', () => {
    const allowed = new Set([
      'cities.raipur', // city selector data
      'checkout.pincodeHint', // PIN check facts
      'checkout.errService',
      'policies.terms.changesBody', // jurisdiction: the courts at Raipur
    ]);
    for (const [loc, tree, re] of [
      ['en', en, /Raipur/],
      ['hi', hi, /रायपुर/],
    ] as const) {
      for (const [key, text] of leaves(tree)) {
        if (!CUSTOMER_PREFIXES.some((p) => key.startsWith(p)) || allowed.has(key)) continue;
        expect(text, `${loc}:${key}`).not.toMatch(re);
      }
    }
  });
});
