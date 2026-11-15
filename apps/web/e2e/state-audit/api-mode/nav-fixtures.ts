/**
 * Quiet answers for the screens a navigation row walks to that no section row owns (batch 3c-3, 2026-11-16):
 * nothing waiting, no coins, no applications. Every body carries its shared schema (hard rule 4). A section row's
 * own mock is listed before these (`auditMocksFor`), so a row that cares about a screen keeps its own answer.
 */
import { CoinLedgerDto, MyCoinsDto } from '@mechdost/shared/coins-api';
import { NoticePreferencesViewDto } from '@mechdost/shared/notice-api';
import { ApplicationPage } from '@mechdost/shared/partner-api';
import { MyShopInvites } from '@mechdost/shared/shop-team';
import type { Mock, Reply } from './mock-api.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

export function navQuietMocks(): Mock[] {
  return [
    {
      method: 'GET',
      path: /^\/admin\/partner-applications$/,
      schema: ApplicationPage,
      reply: (): Reply => ({ body: { items: [], nextCursor: null } satisfies Dto<typeof ApplicationPage> }),
    },
    {
      method: 'GET',
      path: /^\/me\/shop-invites$/,
      schema: MyShopInvites,
      reply: (): Reply => ({ body: { invites: [] } satisfies Dto<typeof MyShopInvites> }),
    },
    {
      method: 'GET',
      path: /^\/me\/coins$/,
      schema: MyCoinsDto,
      reply: (): Reply => ({
        body: {
          balance: 0,
          lifetimeEarned: 0,
          pendingCoins: 0,
          pending: [],
          nextExpiry: null,
          rules: {
            coinValuePaise: 100,
            maxRedeemBp: 2000,
            minOrderPaise: 50000,
            expiryDays: 365,
            unlockDays: 7,
            earnOrderBp: 100,
            firstOrderBonus: 50,
            workshopBookingBonus: 25,
            workshopRewardMinBillPaise: 100000,
            workshopRewardCooldownDays: 30,
          },
        } satisfies Dto<typeof MyCoinsDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/me\/notification-preferences$/,
      schema: NoticePreferencesViewDto,
      reply: (): Reply => ({
        body: { pushTransactional: true, promotions: false, promptSnoozeDays: 7 } satisfies Dto<
          typeof NoticePreferencesViewDto
        >,
      }),
    },
    {
      method: 'GET',
      path: /^\/me\/coins\/ledger$/,
      schema: CoinLedgerDto,
      reply: (): Reply => ({ body: { entries: [], nextCursor: null } satisfies Dto<typeof CoinLedgerDto> }),
    },
  ];
}
