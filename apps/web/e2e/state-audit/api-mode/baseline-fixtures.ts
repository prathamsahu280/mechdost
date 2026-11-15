/**
 * The calls every signed-in page makes on its own, whatever the row is about: the bell's notices (polled on every
 * page), the cart and wishlist refreshes (`?since=<version>` answers "unchanged"), and the lists and details a
 * screen reads after sign-in (service requests, quotes, a workshop's page, the home-visit settings, the photo queue
 * card). They answer with the quiet, empty case; a row that wants something else lists its own mock first
 * (`mocksFor` order wins). Every body carries its shared schema (hard rule 4).
 */
import { CartDto, CartUnchangedDto } from '@mechdost/shared/cart-api';
import { NoticeCountDto, NoticePageDto } from '@mechdost/shared/notice-api';
import { PhotoQueueDto } from '@mechdost/shared/product-photos';
import { QuotePageDto } from '@mechdost/shared/quote-api';
import { HomeSettingsListDto, PublicWorkshopDto, ServiceRequestPageDto } from '@mechdost/shared/service-api';
import { WishlistDto, WishlistUnchangedDto } from '@mechdost/shared/wishlist-api';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { workshop } from './home-fixtures.ts';

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
  ];
}
