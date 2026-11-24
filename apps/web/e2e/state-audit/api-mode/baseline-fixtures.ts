/**
 * The calls every signed-in page makes on its own, whatever the row is about: the bell's notices (polled on every
 * page), the cart and wishlist refreshes (`?since=<version>` answers "unchanged"), and the lists and details a
 * screen reads after sign-in (service requests, quotes, a workshop's page, the home-visit settings, the photo queue
 * card). They answer with the quiet, empty case; a row that wants something else lists its own mock first
 * (`mocksFor` order wins). Every body carries its shared schema (hard rule 4).
 */
import { CartDto, CartUnchangedDto } from '@mechdost/shared/cart-api';
import { NoticeCountDto, NoticePageDto } from '@mechdost/shared/notice-api';
import { CurrentAgreement, InvitePage, PriceRequestPage } from '@mechdost/shared/partner-api';
import { AdminProductPhotosDto, PhotoQueueDto } from '@mechdost/shared/product-photos';
import { ReviewTargetsDto } from '@mechdost/shared/reviews-api';
import { QuotePageDto } from '@mechdost/shared/quote-api';
import {
  AdminWorkshopListDto,
  HomeSettingsListDto,
  PublicWorkshopDto,
  ServiceRequestPageDto,
} from '@mechdost/shared/service-api';
import { WishlistDto, WishlistUnchangedDto } from '@mechdost/shared/wishlist-api';
import { buildCases, type AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { workshop } from './home-fixtures.ts';
import { mocksFor } from './fixtures.ts';
import { roadsideQuietMocks } from './roadside-fixtures.ts';
import { navQuietMocks } from './nav-fixtures.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

/** A body that is either the full answer or the "nothing changed" one, whichever the shared schema accepts. */
const either = (...schemas: { parse(value: unknown): unknown }[]) => ({
  parse(value: unknown): unknown {
    let last: unknown;
    for (const s of schemas) {
      try {
        return s.parse(value);
      } catch (e) {
        last = e;
      }
    }
    throw last;
  },
});

export function baselineMocks(c: AuditCase): Mock[] {
  return [
    {
      method: 'GET',
      path: /^\/me\/notifications$/,
      schema: NoticePageDto,
      reply: (): Reply => ({
        body: { notices: [], nextCursor: null, unread: 0 } satisfies Dto<typeof NoticePageDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/me\/notifications\/unread-count$/,
      schema: NoticeCountDto,
      reply: (): Reply => ({ body: { unread: 0 } satisfies Dto<typeof NoticeCountDto> }),
    },
    {
      method: 'GET',
      path: /^\/me\/cart$/,
      schema: either(CartDto, CartUnchangedDto),
      reply: (ctx): Reply => ({
        body: ctx.query.has('since')
          ? ({ unchanged: true, version: 0 } satisfies Dto<typeof CartUnchangedDto>)
          : ({ lines: [], dropped: [], version: 0 } satisfies Dto<typeof CartDto>),
      }),
    },
    {
      method: 'GET',
      path: /^\/me\/wishlist$/,
      schema: either(WishlistDto, WishlistUnchangedDto),
      reply: (ctx): Reply => ({
        body: ctx.query.has('since')
          ? ({ unchanged: true, version: 0 } satisfies Dto<typeof WishlistUnchangedDto>)
          : ({ items: [], max: 100, version: 0 } satisfies Dto<typeof WishlistDto>),
      }),
    },
    {
      method: 'GET',
      path: /^\/workshop\/home-settings$/,
      schema: HomeSettingsListDto,
      reply: (): Reply => ({ body: { workshops: [] } satisfies Dto<typeof HomeSettingsListDto> }),
    },
    {
      method: 'GET',
      path: /^\/service-requests$/,
      schema: ServiceRequestPageDto,
      reply: (): Reply => ({
        body: { items: [], nextCursor: null } satisfies Dto<typeof ServiceRequestPageDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/quotes$/,
      schema: QuotePageDto,
      reply: (): Reply => ({ body: { items: [], nextCursor: null } satisfies Dto<typeof QuotePageDto> }),
    },
    {
      method: 'GET',
      path: /^\/workshops\/[^/]+$/,
      schema: PublicWorkshopDto,
      reply: (ctx): Reply => {
        const slug = ctx.path.split('/').pop() ?? 'home-garage-1';
        const n = Number(/(\d+)$/.exec(slug)?.[1] ?? '1');
        return { body: { ...workshop(n, c), slug } satisfies Dto<typeof PublicWorkshopDto> };
      },
    },
    {
      method: 'GET',
      path: /^\/admin\/catalogue\/photo-queue$/,
      schema: PhotoQueueDto,
      reply: (): Reply => ({ body: { items: [] } satisfies Dto<typeof PhotoQueueDto> }),
    },
    // Second round (batch 2c, 2026-11-16): the cards a portal or order page loads next to its own screen. Quiet
    // answers (nothing pending, nothing to review, no photos); a row that is about them lists its own mock first.
    {
      method: 'GET',
      path: /^\/admin\/partner-invites$/,
      schema: InvitePage,
      reply: (): Reply => ({ body: { items: [], nextCursor: null } satisfies Dto<typeof InvitePage> }),
    },
    {
      method: 'GET',
      path: /^\/admin\/price-requests$/,
      schema: PriceRequestPage,
      reply: (): Reply => ({ body: { items: [], nextCursor: null } satisfies Dto<typeof PriceRequestPage> }),
    },
    {
      method: 'GET',
      path: /^\/admin\/agreements\/current$/,
      schema: CurrentAgreement,
      reply: (): Reply => ({ body: { agreement: null } satisfies Dto<typeof CurrentAgreement> }),
    },
    {
      method: 'GET',
      path: /^\/admin\/workshops$/,
      schema: AdminWorkshopListDto,
      reply: (): Reply => ({ body: { workshops: [] } satisfies Dto<typeof AdminWorkshopListDto> }),
    },
    {
      method: 'GET',
      path: /^\/my-reviews\/eligible$/,
      schema: ReviewTargetsDto,
      reply: (): Reply => ({ body: { targets: [] } satisfies Dto<typeof ReviewTargetsDto> }),
    },
    {
      method: 'GET',
      path: /^\/(?:shop|admin\/catalogue)\/products\/[^/]+\/photos$/,
      schema: AdminProductPhotosDto,
      reply: (): Reply => ({
        body: { photos: [], max: 8, shopUploadsEnabled: true } satisfies Dto<typeof AdminProductPhotosDto>,
      }),
    },
    // Roadside assistance (spec 22, 2026-11-24): the workshop portal's panel and the admin queue load with their page.
    ...roadsideQuietMocks(),
  ];
}

/**
 * The mocks of the sections a navigation row walks to (batch 3c-3, 2026-11-16): each section row's own set, taken
 * from the first case of the row (the calm default state), so there is one source per screen. Admin bar rows get
 * the admin screens first, account bar rows the other signed-in screens first; the rest follow.
 */
let sectionCases: AuditCase[] | null = null;
function navSectionMocks(c: AuditCase): Mock[] {
  const scroll = c.code === 'API-ADM-SCROLL';
  if (!c.code.startsWith('API-NAV-') && !scroll) return [];
  sectionCases ??= (() => {
    const seen = new Set<string>();
    return buildCases().filter((x) => {
      if (!x.realApi || x.code.startsWith('API-NAV-') || x.code === 'API-ADM-SCROLL' || seen.has(x.code))
        return false;
      seen.add(x.code);
      return true;
    });
  })();
  const admin = c.code === 'API-NAV-ADMIN' || scroll;
  const first = sectionCases.filter((x) => x.code.startsWith('API-ADM-') === admin);
  const rest = sectionCases.filter((x) => x.code.startsWith('API-ADM-') !== admin);
  return [...first, ...rest].flatMap((x) => mocksFor(x)).concat(navQuietMocks());
}

/** Everything the mocked API answers for one case: its row's mocks first, then the baseline (first match wins). */
export function auditMocksFor(c: AuditCase): Mock[] {
  return [...mocksFor(c), ...navSectionMocks(c), ...baselineMocks(c)];
}
