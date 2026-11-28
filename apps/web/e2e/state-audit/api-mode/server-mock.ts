/**
 * The server-side half of the mocked audit API (batch 2c, 2026-11-16).
 *
 * The browser's calls to the API origin are answered by `page.route` (`mock-api.ts`), but the Next server also
 * fetches from `NEXT_PUBLIC_API_URL` while it renders (catalogue pages, product pages, a workshop's page) and while
 * it prefetches a link's page (`?_rsc=`). No browser is in that path, so without an answer the fetch ends in
 * ECONNREFUSED and the page answers 500, which the audit then reported ~700 times as a console error.
 *
 * This module answers those requests from the same typed fixtures (`audit-products.ts`, `home-fixtures.ts`), parsed
 * with the same shared schemas. It is pure (`serverReply`) so it is unit-tested; `server-mock-setup.ts` puts it on
 * `127.0.0.1:4100` for the run. Anything it does not know is a typed 404, which every server reader treats as
 * "not there" (a product page shows not-found, the layout/company/policy/recommendation/review readers fall back to
 * their built-in text).
 */
import { CataloguePageSchema, CatalogueProductSchema } from '@mechdost/shared/catalogue';
import { PublicWorkshopDto } from '@mechdost/shared/service-api';
import {
  AUDIT_PRODUCT_COUNT,
  auditCard,
  auditIndex,
  auditProduct,
  type AuditLocale,
} from './audit-products.ts';
import { workshop } from './home-fixtures.ts';

export interface ServerReply {
  status: number;
  body: unknown;
}

const WORKSHOP_SLUG = /^home-garage-(\d+)$/;
/** One page of the catalogue: enough cards to fill a row of every layout, no next page. */
const PAGE_CARDS = 12;

const localeOf = (query: URLSearchParams): AuditLocale => (query.get('locale') === 'hi' ? 'hi' : 'en');
const notFound = (code: string): ServerReply => ({
  status: 404,
  body: { error: { code, message: code } },
});

export function serverReply(method: string, pathname: string, query: URLSearchParams): ServerReply {
  if (method !== 'GET')
    return { status: 405, body: { error: { code: 'METHOD_NOT_ALLOWED', message: method } } };
  const path = pathname.replace(/^\/v1/, '');
  const locale = localeOf(query);

  // Roadside is on in the launch city (spec 22 "Where it shows"): the header item, SOS tab, home band and footer link.
  // The Mechanic Network is open for the member rows (Learn, Jobs, Saved): the server guard would 404 otherwise.
  if (path === '/ustaad-access') return { status: 200, body: { access: 'open' } };

  if (path === '/roadside/city') return { status: 200, body: { enabled: true, alwaysOpen: true } };

  if (path === '/catalogue/products') {
    const body = {
      place: { cityCode: 'RPR', pincode: null, pincodeKnown: null },
      items: Array.from({ length: Math.min(PAGE_CARDS, AUDIT_PRODUCT_COUNT) }, (_, i) =>
        auditCard(i, locale),
      ),
      nextCursor: null,
    };
    return { status: 200, body: CataloguePageSchema.parse(body) };
  }

  const product = /^\/catalogue\/products\/([^/]+)$/.exec(path);
  if (product) {
    const i = auditIndex(decodeURIComponent(product[1] ?? ''));
    return i === null
      ? notFound('NOT_FOUND')
      : { status: 200, body: CatalogueProductSchema.parse(auditProduct(i, locale)) };
  }

  const shop = /^\/workshops\/([^/]+)$/.exec(path);
  if (shop) {
    const slug = decodeURIComponent(shop[1] ?? '');
    const n = Number(WORKSHOP_SLUG.exec(slug)?.[1]);
    if (!Number.isInteger(n) || n < 1) return notFound('NOT_FOUND');
    return { status: 200, body: PublicWorkshopDto.parse(workshop(n, { locale, state: {} })) };
  }

  return notFound('NOT_MOCKED');
}
