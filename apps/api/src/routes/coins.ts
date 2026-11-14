import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  adjustCoins,
  adminCoinAccount,
  coinActivity,
  myCoinLedger,
  myCoins,
  type CoinLedgerView,
  type PendingRewardView,
} from '@mechdost/db/repo';
import { COIN_ADJUST_REASONS, COIN_LEDGER_KINDS, COIN_REWARD_SOURCES } from '@mechdost/shared/coins';
import type { SessionCache } from '../auth/session-cache';
import { authenticate, requirePermission, requireVerified } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * MechDost Coins (spec 20): a loyalty bonus, never a wallet. Customers read their own balance, coins on the way,
 * the next expiry, the rules and their history (`/me/coins`). Staff read an account and recent activity with
 * `coins:read`, and grant or deduct with `coins:adjust` (reason code, account version, Idempotency-Key; audited).
 * Spending happens only inside `POST /orders` (`coins`); earning, restoring and expiry are server-side.
 */
export const ADJUST_RATE: RateRule = { name: 'coins_adjust_user', limit: 30, windowSeconds: 600 };

const Uuid = z.uuid();
const Cursor = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

const Entry = z
  .object({
    id: z.string(),
    delta: z.number().int(),
    kind: z.enum(COIN_LEDGER_KINDS),
    reasonCode: z.string().nullable(),
    /** Staff note on an adjustment (written for the customer); null otherwise. */
    note: z.string().nullable(),
    orderCode: z.string().nullable(),
    createdAt: z.string(),
    expiresAt: z.string().nullable(),
  })
  .openapi('CoinEntry');
const Pending = z
  .object({
    id: z.string(),
    source: z.enum(COIN_REWARD_SOURCES),
    coins: z.number().int(),
    availableAt: z.string(),
    orderCode: z.string().nullable(),
  })
  .openapi('CoinPendingReward');
const Rules = z
  .object({
    coinValuePaise: z.number().int(),
    maxRedeemBp: z.number().int(),
    minOrderPaise: z.number().int(),
    expiryDays: z.number().int(),
    unlockDays: z.number().int(),
    earnOrderBp: z.number().int(),
    firstOrderBonus: z.number().int(),
    workshopBookingBonus: z.number().int(),
  })
  .openapi('CoinRules');
const Summary = z
  .object({
    balance: z.number().int(),
    lifetimeEarned: z.number().int(),
    pendingCoins: z.number().int(),
    pending: z.array(Pending),
    nextExpiry: z.object({ coins: z.number().int(), at: z.string() }).nullable(),
    rules: Rules,
  })
  .openapi('MyCoins');
const Ledger = z.object({ entries: z.array(Entry), nextCursor: z.string().nullable() }).openapi('CoinLedger');
const AdminAccount = z
  .object({
    userId: z.string(),
    balance: z.number().int(),
    lifetimeEarned: z.number().int(),
    version: z.number().int().nullable(),
    pending: z.array(Pending),
    entries: z.array(Entry.extend({ createdBy: z.string().nullable() })),
  })
  .openapi('AdminCoinAccount');
const Activity = z
  .object({ entries: z.array(Entry.extend({ userId: z.string() })), nextCursor: z.string().nullable() })
  .openapi('AdminCoinActivity');
const Adjusted = z
  .object({ id: z.string(), delta: z.number().int(), kind: z.string(), balanceAfter: z.number().int() })
  .openapi('CoinAdjusted');

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});

const entryJson = (e: CoinLedgerView) => ({
  ...e,
  createdAt: e.createdAt.toISOString(),
  expiresAt: e.expiresAt?.toISOString() ?? null,
});
const pendingJson = (p: PendingRewardView) => ({ ...p, availableAt: p.availableAt.toISOString() });

const mine = createRoute({
  method: 'get',
  path: '/me/coins',
  tags: ['coins'],
  summary: 'Your MechDost Coins: balance, coins on the way, the next expiry and the rules',
  security: [{ bearerAuth: [] }],
  responses: { 200: json(Summary, 'Coins'), ...errorResponses },
});

const myLedger = createRoute({
  method: 'get',
  path: '/me/coins/ledger',
  tags: ['coins'],
  summary: 'Your coin history, newest first (pass `nextCursor` back as `cursor`)',
  security: [{ bearerAuth: [] }],
  request: { query: Cursor },
  responses: { 200: json(Ledger, 'History'), 422: json(ErrorSchema, 'INVALID_CURSOR'), ...errorResponses },
});

const account = createRoute({
  method: 'get',
  path: '/admin/coins/accounts/{userId}',
  tags: ['admin'],
  summary: 'One customer’s coins: balance, version, coins on the way, latest history (coins:read)',
  security: [{ bearerAuth: [] }],
  request: { params: z.object({ userId: Uuid.openapi({ param: { name: 'userId', in: 'path' } }) }) },
  responses: { 200: json(AdminAccount, 'Account'), 404: json(ErrorSchema, 'Not found'), ...errorResponses },
});

const activity = createRoute({
  method: 'get',
  path: '/admin/coins/activity',
  tags: ['admin'],
  summary: 'Recent coin activity across customers, newest first (coins:read)',
  security: [{ bearerAuth: [] }],
  request: { query: Cursor },
  responses: { 200: json(Activity, 'Activity'), 422: json(ErrorSchema, 'INVALID_CURSOR'), ...errorResponses },
});

const adjust = createRoute({
  method: 'post',
  path: '/admin/coins/accounts/{userId}/adjust',
  tags: ['admin'],
  summary: 'Grant (+) or deduct (−) coins with a reason code (coins:adjust; Idempotency-Key; audited)',
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({ userId: Uuid.openapi({ param: { name: 'userId', in: 'path' } }) }),
    headers: z.object({ 'idempotency-key': z.string().regex(/^[A-Za-z0-9_-]{16,64}$/) }),
    body: {
      required: true,
      content: {
        'application/json': {
          schema: z
            .object({
              delta: z
                .number()
                .int()
                .min(-100_000)
                .max(100_000)
                .refine((d) => d !== 0, 'Not zero'),
              reasonCode: z.enum(COIN_ADJUST_REASONS),
              note: z.string().trim().min(3).max(200).nullable().optional(),
              /** The account version the screen showed (null = no coins yet). */
              version: z.number().int().min(1).nullable(),
            })
            .strict()
            .openapi('CoinAdjust'),
        },
      },
    },
  },
  responses: {
    200: json(Adjusted, 'Applied (or the same request again)'),
    404: json(ErrorSchema, 'Not found'),
    409: json(ErrorSchema, 'STALE_COINS, INSUFFICIENT_COINS, COINS_IDEM_MISMATCH'),
    ...errorResponses,
  },
});

export function coinRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  // One pattern per prefix: '/me/coins/*' also matches '/me/coins' (L54), so nothing runs twice.
  for (const path of ['/me/coins/*', '/admin/coins/*']) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
  }
  app.use('/admin/coins/*', requireVerified);
  app.use('/admin/coins/*', requirePermission('coins:read'));
  app.on('POST', '/admin/coins/*', requirePermission('coins:adjust'));
  app.on(
    'POST',
    '/admin/coins/*',
    rateLimit(deps.rateLimiter, ADJUST_RATE, (c) => c.get('auth').user.id),
  );

  return app
    .openapi(mine, async (c) => {
      const s = await myCoins(deps.db, c.get('auth').user.id);
      return c.json(
        {
          ...s,
          pending: s.pending.map(pendingJson),
          nextExpiry: s.nextExpiry ? { coins: s.nextExpiry.coins, at: s.nextExpiry.at.toISOString() } : null,
        },
        200,
      );
    })
    .openapi(myLedger, async (c) => {
      const page = await myCoinLedger(deps.db, c.get('auth').user.id, c.req.valid('query'));
      return c.json({ entries: page.entries.map(entryJson), nextCursor: page.nextCursor }, 200);
    })
    .openapi(account, async (c) => {
      const a = await adminCoinAccount(deps.db, c.req.valid('param').userId);
      return c.json(
        {
          ...a,
          pending: a.pending.map(pendingJson),
          entries: a.entries.map((e) => ({ ...entryJson(e), createdBy: e.createdBy })),
        },
        200,
      );
    })
    .openapi(activity, async (c) => {
      const page = await coinActivity(deps.db, c.req.valid('query'));
      return c.json(
        {
          entries: page.entries.map((e) => ({ ...entryJson(e), userId: e.userId })),
          nextCursor: page.nextCursor,
        },
        200,
      );
    })
    .openapi(adjust, async (c) => {
      const b = c.req.valid('json');
      const entry = await adjustCoins(deps.db, {
        userId: c.req.valid('param').userId,
        delta: b.delta,
        reasonCode: b.reasonCode,
        note: b.note ?? null,
        idemKey: `adjust:${c.req.valid('header')['idempotency-key']}`,
        staffUserId: c.get('auth').user.id,
        expectedVersion: b.version,
      });
      return c.json(entry, 200);
    });
}
