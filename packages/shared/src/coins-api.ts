/**
 * Response shapes of the MechDost Coins routes (`apps/api/src/routes/coins.ts`, spec 20), for the website in real
 * mode to validate what it receives (hard rule 4). Loaded only by the real-mode coin screens (lazy imports), never by
 * the demo pages. The maths (`coinRedemption`) lives in the Zod-free `./coins`.
 */
import { z } from 'zod';
import { COIN_LEDGER_KINDS, COIN_REWARD_SOURCES } from './coins';

export const CoinEntryDto = z.object({
  id: z.string(),
  delta: z.number().int(),
  kind: z.enum(COIN_LEDGER_KINDS),
  reasonCode: z.string().nullable(),
  note: z.string().nullable(),
  orderCode: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type CoinEntryView = z.infer<typeof CoinEntryDto>;

export const CoinPendingDto = z.object({
  id: z.string(),
  source: z.enum(COIN_REWARD_SOURCES),
  coins: z.number().int(),
  availableAt: z.string(),
  orderCode: z.string().nullable(),
});
export type CoinPendingView = z.infer<typeof CoinPendingDto>;

export const CoinRulesDto = z.object({
  coinValuePaise: z.number().int(),
  maxRedeemBp: z.number().int(),
  minOrderPaise: z.number().int(),
  expiryDays: z.number().int(),
  unlockDays: z.number().int(),
  earnOrderBp: z.number().int(),
  firstOrderBonus: z.number().int(),
  workshopBookingBonus: z.number().int(),
});
export type CoinRulesView = z.infer<typeof CoinRulesDto>;

export const MyCoinsDto = z.object({
  balance: z.number().int(),
  lifetimeEarned: z.number().int(),
  pendingCoins: z.number().int(),
  pending: z.array(CoinPendingDto),
  nextExpiry: z.object({ coins: z.number().int(), at: z.string() }).nullable(),
  rules: CoinRulesDto,
});
export type MyCoinsView = z.infer<typeof MyCoinsDto>;

export const CoinLedgerDto = z.object({ entries: z.array(CoinEntryDto), nextCursor: z.string().nullable() });
export type CoinLedgerPage = z.infer<typeof CoinLedgerDto>;

export const AdminCoinAccountDto = z.object({
  userId: z.string(),
  balance: z.number().int(),
  lifetimeEarned: z.number().int(),
  version: z.number().int().nullable(),
  pending: z.array(CoinPendingDto),
  entries: z.array(CoinEntryDto.extend({ createdBy: z.string().nullable() })),
});
export type AdminCoinAccountView = z.infer<typeof AdminCoinAccountDto>;

export const AdminCoinActivityDto = z.object({
  entries: z.array(CoinEntryDto.extend({ userId: z.string() })),
  nextCursor: z.string().nullable(),
});
export type AdminCoinActivityView = z.infer<typeof AdminCoinActivityDto>;

export const CoinAdjustedDto = z.object({
  id: z.string(),
  delta: z.number().int(),
  kind: z.string(),
  balanceAfter: z.number().int(),
});
