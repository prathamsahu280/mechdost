import { createHash } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { publicCode } from '@mechdost/shared/ids';
import type { AdminQuoteView } from '@mechdost/shared/quote-api';
import {
  QUOTE_CUSTOMER_MESSAGES_PER_HOUR,
  QUOTE_INACTIVE_DAYS,
  QUOTE_LINE_MAX_QTY,
  QUOTE_MAX_LINES,
  QUOTE_MESSAGE_MAX,
  QUOTE_OFFER_MAX_DAYS,
  QUOTE_OFFER_MIN_DAYS,
  QUOTE_OPEN_LIMIT,
  QUOTE_THREAD_LIMIT,
  quoteOfferTotal,
} from '@mechdost/shared/quote-rules';
import { blockEffects } from '@mechdost/shared/customers';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { istDateString } from '@mechdost/shared/time';
import {
  QUOTE_OPEN_STATES,
  quoteMachine,
  type QuoteDeclineReason,
  type QuoteExpireReason,
  type QuoteOfferStatus,
  type QuoteStatus,
  type QuoteWithdrawReason,
} from '@mechdost/shared/state';
import {
  auditLog,
  cities,
  orderGroups,
  pincodes,
  quoteEvents,
  quoteLines,
  quoteMessages,
  quoteOffers,
  quoteRequests,
} from '../schema';
import { placeOrder, quoteCheckout, settingOr } from './checkout';
import { activeBlockLevels } from './customer-blocks';
import { decodeCursor, encodeCursor, pageSize } from './cursor';
import { ConflictError, ForbiddenError, NotFoundError, pgCode, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { localized } from './localized';
import { queueEmail } from './email-notifications';
import { queueQuoteWhatsApp } from './quote-notifications';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { rowsOf } from './sql-rows';

/**
 * Bulk quotes (spec 19). A signed-in customer asks for a bulk price; MechDost staff (`quotes:negotiate`, city-scoped)
 * talk in a thread and send versioned offers; the customer accepts exactly the latest unexpired offer, which places a
 * normal cash-on-delivery order through `placeOrder` with the negotiated prices (routing and fulfilment unchanged).
 *
 * Integrity (spec 14): every transaction locks the **quote row first** (then offers, then the order tables through
 * `placeOrder`); status changes go through `quoteMachine` and a conditional UPDATE on (id, status, version); a quote
 * creates at most one order (`order_groups.quote_id` partial unique) and the accept is idempotent per key. Customers
 * reach only their own quotes, staff only quotes in their cities; anything else is 404. Message bodies are personal
 * data: stored, never logged or sent to analytics.
 */
export type QuoteLocale = 'en' | 'hi';

export interface QuoteAddress {
  contactName: string;
  contactPhone: string;
  line1: string;
  landmark: string | null;
  pincode: string;
}

export interface QuoteLineRequest {
  slug: string;
  sku?: string | null;
  qty: number;
}

const MIN_UNITS_KEY = 'quotes.min_units';
const MIN_UNITS = { key: MIN_UNITS_KEY, fallback: OPERATIONAL_SETTINGS[MIN_UNITS_KEY].default };
const COD_CAP_KEY = 'quotes.cod_cap_paise';
const COD_CAP = { key: COD_CAP_KEY, fallback: OPERATIONAL_SETTINGS[COD_CAP_KEY].default };
const OPEN: readonly QuoteStatus[] = QUOTE_OPEN_STATES;
const DAY_MS = 86_400_000;
const inactiveDeadline = (from: Date) => new Date(from.getTime() + QUOTE_INACTIVE_DAYS * DAY_MS);

// ── views ─────────────────────────────────────────────────────────────────────────────────────────────────────

export interface QuoteOfferBrief {
  version: number;
  totalPaise: number;
  validUntil: string;
  expired: boolean;
}

export interface QuoteSummaryView {
  code: string;
  status: QuoteStatus;
  cityCode: string;
  pincode: string;
  lines: number;
  units: number;
  listTotalPaise: number | null;
  lastMessageAt: string | null;
  lastMessageBy: 'customer' | 'staff' | null;
  offer: QuoteOfferBrief | null;
  orderCode: string | null;
  createdAt: string;
  version: number;
}

export interface QuoteOfferView {
  version: number;
  status: QuoteOfferStatus;
  lines: { lineNo: number; unitPaise: number }[];
  subtotalPaise: number;
  deliveryPaise: number;
  totalPaise: number;
  validUntil: string;
  expired: boolean;
  terms: string | null;
  createdAt: string;
}

export interface QuoteDetailView extends QuoteSummaryView {
  lineItems: {
    lineNo: number;
    slug: string;
    sku: string;
    title: string;
    qty: number;
    listUnitPaise: number | null;
    mrpPaise: number;
    /** Staff only (null for customers): the lowest approved shop price that can supply the line at the PIN. */
    costPaise: number | null;
    /** Staff only (null for customers): the most units one covering shop has free right now. */
    stock: number | null;
  }[];
  currentOffer: QuoteOfferView | null;
  messages: { id: string; from: 'customer' | 'staff' | 'system'; body: string; at: string }[];
  address: QuoteAddress;
  reasonCode: string | null;
  closingMessage: string | null;
}

interface SummaryRow {
  id: string;
  code: string;
  status: string;
  city_code: string;
  pincode: string;
  lines: number | string;
  units: number;
  list_total_paise: number | string | null;
  last_message_at: Date | string | null;
  last_message_by: string | null;
  offer_version: number | string | null;
  offer_total: number | string | null;
  offer_valid_until: Date | string | null;
  order_code: string | null;
  created_at: Date | string;
  created_key: string;
  version: number;
}

const iso = (d: Date | string) => new Date(d).toISOString();
const numOrNull = (v: number | string | null) => (v === null ? null : Number(v));

/** The latest offer the customer can act on (active) or did act on (accepted), as one LATERAL row `o`. */
const SUMMARY_SELECT = sql`
  select q.id, q.code, q.status, c.code as city_code, q.pincode,
    (select count(*) from quote_lines l where l.quote_id = q.id) as lines,
    q.units, q.list_total_paise, q.last_message_at, q.last_message_by,
    o.offer_version, o.total_paise as offer_total, o.valid_until as offer_valid_until,
    g.code as order_code, q.created_at, q.created_at::text as created_key, q.version
  from quote_requests q
  join cities c on c.id = q.city_id
  left join lateral (
    select offer_version, total_paise, valid_until from quote_offers
    where quote_id = q.id and status in ('active','accepted')
    order by offer_version desc limit 1) o on true
  left join order_groups g on g.quote_id = q.id`;

function toSummary(r: SummaryRow, now: Date): QuoteSummaryView {
  const offer =
    r.offer_version === null || r.offer_valid_until === null || r.offer_total === null
      ? null
      : {
          version: Number(r.offer_version),
          totalPaise: Number(r.offer_total),
          validUntil: iso(r.offer_valid_until),
          expired: r.status !== 'accepted' && new Date(r.offer_valid_until) <= now,
        };
  return {
    code: r.code,
    status: r.status as QuoteStatus,
    cityCode: r.city_code,
    pincode: r.pincode,
    lines: Number(r.lines),
    units: r.units,
    listTotalPaise: numOrNull(r.list_total_paise),
    lastMessageAt: r.last_message_at === null ? null : iso(r.last_message_at),
    lastMessageBy:
      r.last_message_by === 'customer' || r.last_message_by === 'staff' ? r.last_message_by : null,
    offer,
    orderCode: r.order_code,
    createdAt: iso(r.created_at),
    version: r.version,
  };
}

function scopeSql(scope: CityScope): SQL {
  if (scope.all) return sql`true`;
  if (scope.cityIds.length === 0) return sql`false`;
  return sql`q.city_id in (${sql.join(
    scope.cityIds.map((c) => sql`${c}::uuid`),
    sql`, `,
  )})`;
}

async function summaries(
  db: Tx,
  where: SQL,
  page: { cursor: string | null; limit?: number },
): Promise<{ items: QuoteSummaryView[]; nextCursor: string | null }> {
  const limit = pageSize(page.limit, 20, 50);
  const after = page.cursor ? decodeCursor(page.cursor, 'timestamp') : null;
  const keyset = after ? sql`and (q.created_at, q.id) < (${after.k}::timestamptz, ${after.id}::uuid)` : sql``;
  const rows = rowsOf<SummaryRow>(
    await db.execute(sql`${SUMMARY_SELECT}
      where ${where} ${keyset}
      order by q.created_at desc, q.id desc
      limit ${limit + 1}`),
  );
  const now = new Date();
  const items = rows.slice(0, limit).map((r) => toSummary(r, now));
  const last = rows.length > limit ? rows[limit - 1] : undefined;
  return { items, nextCursor: last ? encodeCursor({ k: last.created_key, id: last.id }) : null };
}

async function detail(db: Tx, where: SQL, locale: QuoteLocale, staffView: boolean): Promise<QuoteDetailView> {
  const [row] = rowsOf<
    SummaryRow & {
      shipping_address: QuoteAddress;
      status_reason_code: string | null;
      closing_message: string | null;
    }
  >(
    await db.execute(sql`
      select s.*, q.shipping_address, q.status_reason_code, q.closing_message
      from (${SUMMARY_SELECT} where ${where} limit 1) s
      join quote_requests q on q.id = s.id`),
  );
  if (!row) throw new NotFoundError('Quote not found');
  const now = new Date();
  const lines = await db
    .select()
    .from(quoteLines)
    .where(eq(quoteLines.quoteId, row.id))
    .orderBy(asc(quoteLines.lineNo));
  const [offer] = await db
    .select()
    .from(quoteOffers)
    .where(and(eq(quoteOffers.quoteId, row.id), inArray(quoteOffers.status, ['active', 'accepted'])))
    .orderBy(desc(quoteOffers.offerVersion))
    .limit(1);
  const messages = (
    await db
      .select({
        id: quoteMessages.id,
        role: quoteMessages.authorRole,
        body: quoteMessages.body,
        at: quoteMessages.createdAt,
      })
      .from(quoteMessages)
      .where(eq(quoteMessages.quoteId, row.id))
      .orderBy(desc(quoteMessages.createdAt), desc(quoteMessages.id))
      .limit(QUOTE_THREAD_LIMIT)
  ).reverse();
  const a = row.shipping_address;
  const costs = staffView ? await lineCosts(db, row.id, row.pincode) : null;
  return {
    ...toSummary(row, now),
    lineItems: lines.map((l) => ({
      lineNo: l.lineNo,
      slug: l.slug,
      sku: l.sku,
      title: localized(l.title, l.titleHi, locale),
      qty: l.qty,
      listUnitPaise: l.listUnitPaise,
      mrpPaise: l.mrpPaise,
      costPaise: costs?.get(l.lineNo)?.costPaise ?? null,
      stock: costs ? (costs.get(l.lineNo)?.stock ?? 0) : null,
    })),
    currentOffer: offer
      ? {
          version: offer.offerVersion,
          status: offer.status as QuoteOfferStatus,
          lines: offerLines(offer.lines),
          subtotalPaise: offer.subtotalPaise,
          deliveryPaise: offer.deliveryPaise,
          totalPaise: offer.totalPaise,
          validUntil: offer.validUntil.toISOString(),
          expired: offer.status === 'active' && offer.validUntil <= now,
          terms: offer.terms,
          createdAt: offer.createdAt.toISOString(),
        }
      : null,
    messages: messages.map((m) => ({
      id: m.id,
      from: m.role === 'staff' || m.role === 'system' ? m.role : 'customer',
      body: m.body,
      at: m.at.toISOString(),
    })),
    address: {
      contactName: a.contactName,
      // Staff work the quote without the full number (customers:read_pii is not part of negotiating).
      contactPhone: staffView ? `••••${a.contactPhone.slice(-4)}` : a.contactPhone,
      line1: a.line1,
      landmark: a.landmark,
      pincode: a.pincode,
    },
    reasonCode: row.status_reason_code,
    closingMessage: row.closing_message,
  };
}

/**
 * Per line, at the quote's PIN: the lowest approved shop price among covering shops that have the whole quantity free
 * (the cost floor staff should not offer below without meaning to) and the most units one shop has free.
 */
async function lineCosts(
  db: Tx,
  quoteId: string,
  pincode: string,
): Promise<Map<number, { costPaise: number | null; stock: number }>> {
  const rows = rowsOf<{ line_no: number; cost: number | string | null; stock: number | string | null }>(
    await db.execute(sql`
      select l.line_no,
        min(si.selling_paise) filter (where si.on_hand - si.reserved >= l.qty) as cost,
        max(si.on_hand - si.reserved) as stock
      from quote_lines l
      left join shop_inventory si on si.variant_id = l.variant_id and si.active and not si.admin_blocked
        and exists (
          select 1 from shops s join shop_pincodes sp on sp.shop_id = s.id and sp.pincode = ${pincode} and sp.active
          where s.id = si.shop_id and s.status = 'approved' and s.gst_status = 'registered'
            and not (s.busy and (s.busy_until is null or s.busy_until > now())))
      where l.quote_id = ${quoteId}
      group by l.line_no`),
  );
  return new Map(
    rows.map((r) => [r.line_no, { costPaise: numOrNull(r.cost), stock: Math.max(0, Number(r.stock ?? 0)) }]),
  );
}

function offerLines(value: unknown): { lineNo: number; unitPaise: number }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((l: unknown) => {
    if (typeof l !== 'object' || l === null) return [];
    const { lineNo, unitPaise } = l as { lineNo?: unknown; unitPaise?: unknown };
    return typeof lineNo === 'number' && typeof unitPaise === 'number' ? [{ lineNo, unitPaise }] : [];
  });
}

// ── shared steps ──────────────────────────────────────────────────────────────────────────────────────────────

interface LockedQuote {
  id: string;
  code: string;
  userId: string;
  cityId: string;
  status: QuoteStatus;
  version: number;
  offerVersion: number;
  listTotalPaise: number | null;
  shippingAddress: QuoteAddress;
}

async function lockQuote(tx: Tx, where: SQL): Promise<LockedQuote> {
  const [q] = await tx
    .select({
      id: quoteRequests.id,
      code: quoteRequests.code,
      userId: quoteRequests.userId,
      cityId: quoteRequests.cityId,
      status: quoteRequests.status,
      version: quoteRequests.version,
      offerVersion: quoteRequests.offerVersion,
      listTotalPaise: quoteRequests.listTotalPaise,
      shippingAddress: quoteRequests.shippingAddress,
    })
    .from(quoteRequests)
    .where(where)
    .limit(1)
    .for('update');
  if (!q) throw new NotFoundError('Quote not found');
  return {
    ...q,
    status: q.status as QuoteStatus,
    shippingAddress: q.shippingAddress as QuoteAddress,
  };
}

const staffWhere = (scope: CityScope, code: string): SQL =>
  scope.all
    ? eq(quoteRequests.code, code)
    : scope.cityIds.length === 0
      ? sql`false`
      : (and(eq(quoteRequests.code, code), inArray(quoteRequests.cityId, [...scope.cityIds])) ?? sql`false`);

const mineWhere = (userId: string, code: string): SQL =>
  and(eq(quoteRequests.code, code), eq(quoteRequests.userId, userId)) ?? sql`false`;

function assertOpen(q: LockedQuote): void {
  if (!OPEN.includes(q.status)) throw new ConflictError('This quote is closed', 'QUOTE_CLOSED');
}

interface QuoteActor {
  type: 'customer' | 'admin' | 'system';
  userId: string | null;
}

/** Compare-and-set a status change (machine-checked), with its event and audit row. */
async function transition(
  tx: Tx,
  q: LockedQuote,
  to: QuoteStatus,
  actor: QuoteActor,
  set: Partial<typeof quoteRequests.$inferInsert> = {},
  payload: Record<string, unknown> = {},
): Promise<number> {
  quoteMachine.assert(q.status, to, actor.type);
  const closing = !OPEN.includes(to);
  const [row] = await tx
    .update(quoteRequests)
    .set({ ...set, status: to, ...(closing ? { closedAt: new Date() } : {}) })
    .where(
      and(
        eq(quoteRequests.id, q.id),
        eq(quoteRequests.status, q.status),
        eq(quoteRequests.version, q.version),
      ),
    )
    .returning({ version: quoteRequests.version });
  if (!row) throw new ConflictError('This quote changed; reload and try again', 'STALE_QUOTE');
  await tx.insert(quoteEvents).values({
    quoteId: q.id,
    kind: 'status',
    fromStatus: q.status,
    toStatus: to,
    actorType: actor.type,
    actorId: actor.userId,
    payload,
  });
  await tx.insert(auditLog).values({
    actorUserId: actor.userId,
    actorRole: actor.type === 'admin' ? 'staff' : actor.type,
    action: `quote.${to}`,
    entity: 'quote_request',
    entityId: q.id,
    before: { status: q.status },
    after: { status: to, ...payload },
  });
  return row.version;
}

function requestHash(input: {
  lines: readonly QuoteLineRequest[];
  address: QuoteAddress;
  note: string | null;
}) {
  const a = input.address;
  return createHash('sha256')
    .update(
      JSON.stringify([
        [a.contactName, a.contactPhone, a.line1, a.landmark, a.pincode],
        [...input.lines]
          .map((l) => [l.slug, l.sku ?? null, l.qty])
          .sort((x, y) => String(x[0]).localeCompare(String(y[0]))),
        input.note,
      ]),
    )
    .digest('hex');
}

// ── customer ──────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The bulk-quote rules for the request form: minimum units (admin setting: the PIN code's city value when a PIN is
 * given, else the global value), limits and the customer's open count.
 */
export async function quoteRules(
  db: Tx,
  userId: string,
  pincode: string | null = null,
): Promise<{ minUnits: number; maxLines: number; maxQty: number; openLimit: number; open: number }> {
  const city = pincode ? await serviceableCity(db, pincode) : null;
  const minUnits = city ? await settingOr(db, city.cityId, MIN_UNITS) : await globalSetting(db, MIN_UNITS);
  const open = await db.$count(
    quoteRequests,
    and(eq(quoteRequests.userId, userId), inArray(quoteRequests.status, [...OPEN])),
  );
  return {
    minUnits,
    maxLines: QUOTE_MAX_LINES,
    maxQty: QUOTE_LINE_MAX_QTY,
    openLimit: QUOTE_OPEN_LIMIT,
    open,
  };
}

/** The global value of a numeric setting (no city), else its registry default. */
async function globalSetting(db: Tx, s: { key: string; fallback: number }): Promise<number> {
  const [row] = rowsOf<{ value: unknown }>(
    await db.execute(sql`select value from settings where key = ${s.key} and city_id is null limit 1`),
  );
  const v = row?.value;
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : s.fallback;
}

/** The live city of an active PIN code we deliver to, else null. */
async function serviceableCity(db: Tx, pincode: string) {
  const [place] = await db
    .select({ cityId: cities.id, cityCode: cities.code })
    .from(pincodes)
    .innerJoin(cities, eq(cities.id, pincodes.cityId))
    .where(and(eq(pincodes.pincode, pincode), eq(pincodes.active, true), eq(cities.status, 'live')));
  return place ?? null;
}

/**
 * Ask for a bulk price. Same idempotency key (per customer) → the same quote; a different request under that key is
 * refused. Errors: QUOTE_MIN_UNITS, QUOTE_PRODUCT_UNAVAILABLE (details.slugs), DUPLICATE_LINE,
 * PINCODE_NOT_SERVICEABLE, QUOTE_OPEN_LIMIT, IDEMPOTENCY_MISMATCH.
 */
export async function createQuote(
  db: Tx,
  input: {
    userId: string;
    idempotencyKey: string;
    lines: readonly QuoteLineRequest[];
    address: QuoteAddress;
    note: string | null;
    locale: QuoteLocale;
  },
): Promise<{ code: string; status: QuoteStatus; version: number; replayed: boolean }> {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(input.idempotencyKey))
    throw new ValidationError('Invalid idempotency key', 'IDEMPOTENCY_KEY');
  if (input.lines.length === 0 || input.lines.length > QUOTE_MAX_LINES)
    throw new ValidationError(`A quote has 1 to ${String(QUOTE_MAX_LINES)} products`, 'QUOTE_SIZE');
  if (input.lines.some((l) => !Number.isInteger(l.qty) || l.qty < 1 || l.qty > QUOTE_LINE_MAX_QTY))
    throw new ValidationError(`Quantity must be 1 to ${String(QUOTE_LINE_MAX_QTY)}`, 'LINE_QTY');
  const note = input.note?.trim() ? input.note.trim().slice(0, QUOTE_MESSAGE_MAX) : null;
  const hash = requestHash({ ...input, note });

  return db.transaction(async (tx) => {
    // Serialise per customer: the open-quote limit and the idempotency check cannot race.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`quote-create:${input.userId}`}, 0))`,
    );
    const [existing] = await tx
      .select({
        code: quoteRequests.code,
        status: quoteRequests.status,
        version: quoteRequests.version,
        requestHash: quoteRequests.requestHash,
      })
      .from(quoteRequests)
      .where(
        and(eq(quoteRequests.userId, input.userId), eq(quoteRequests.idempotencyKey, input.idempotencyKey)),
      );
    if (existing) {
      if (existing.requestHash !== hash)
        throw new ValidationError(
          'This request key was already used for a different quote',
          'IDEMPOTENCY_MISMATCH',
        );
      return {
        code: existing.code,
        status: existing.status as QuoteStatus,
        version: existing.version,
        replayed: true,
      };
    }

    // Quote orders are cash on delivery: a customer who may not order, or not pay cash, cannot ask (review minor).
    const allowed = blockEffects(await activeBlockLevels(tx, input.userId));
    if (!allowed.order) throw new ForbiddenError('This account cannot place orders', 'ORDERS_BLOCKED');
    if (!allowed.cod)
      throw new ForbiddenError(
        'Bulk quotes are paid cash on delivery, which this account cannot use',
        'QUOTE_COD_BLOCKED',
      );

    const place = await serviceableCity(tx, input.address.pincode);
    if (!place)
      throw new ValidationError('We do not deliver to this PIN code yet', 'PINCODE_NOT_SERVICEABLE');

    const units = input.lines.reduce((sum, l) => sum + l.qty, 0);
    const minUnits = await settingOr(tx, place.cityId, MIN_UNITS);
    if (units < minUnits)
      throw new ValidationError(`A bulk quote needs at least ${String(minUnits)} units`, 'QUOTE_MIN_UNITS', {
        minUnits,
      });

    // Live products only; the SKU (when given) must be an active pack of that product, else its first active pack.
    const resolved = rowsOf<{
      ord: number;
      slug: string;
      product_id: string | null;
      variant_id: string | null;
      sku: string | null;
      mrp_paise: number | string | null;
      name: string | null;
      name_hi: string | null;
      brand: string | null;
    }>(
      await tx.execute(sql`
        select l.ord, l.slug, p.id as product_id, v.id as variant_id, v.sku, v.mrp_paise, p.name, p.name_hi,
          b.name as brand
        from jsonb_to_recordset(${JSON.stringify(
          input.lines.map((l, i) => ({ ord: i, slug: l.slug, sku: l.sku ?? null })),
        )}::jsonb) as l(ord int, slug text, sku text)
        left join products p on p.slug = l.slug and p.status = 'live'
        left join brands b on b.id = p.brand_id
        left join lateral (
          select pv.id, pv.sku, pv.mrp_paise from product_variants pv
          where pv.product_id = p.id and pv.status = 'active' and (l.sku is null or pv.sku = l.sku)
          order by pv.created_at, pv.sku limit 1) v on true
        order by l.ord`),
    );
    const missing = resolved.filter((r) => !r.variant_id || !r.sku).map((r) => r.slug);
    if (missing.length > 0)
      throw new ValidationError('Some products cannot be quoted', 'QUOTE_PRODUCT_UNAVAILABLE', {
        slugs: missing,
      });
    const variants = new Set(resolved.map((r) => r.variant_id));
    if (variants.size !== resolved.length)
      throw new ValidationError('Each product appears once', 'DUPLICATE_LINE');

    const open = await tx.$count(
      quoteRequests,
      and(eq(quoteRequests.userId, input.userId), inArray(quoteRequests.status, [...OPEN])),
    );
    if (open >= QUOTE_OPEN_LIMIT)
      throw new ValidationError(
        `You can have ${String(QUOTE_OPEN_LIMIT)} bulk quotes open at a time`,
        'QUOTE_OPEN_LIMIT',
        { openLimit: QUOTE_OPEN_LIMIT },
      );

    // The catalogue price per unit for this PIN today (information for staff and the customer, not a promise).
    const prices = await quoteCheckout(tx, {
      pincode: input.address.pincode,
      lines: resolved.map((r) => ({ sku: r.sku ?? '', qty: 1 })),
      locale: 'en',
    });
    const priceBySku = new Map(prices.lines.map((l) => [l.sku, l.unitPaise]));
    const lineRows = resolved.map((r, i) => {
      const qty = input.lines[i]?.qty ?? 1;
      return {
        lineNo: i + 1,
        productId: r.product_id ?? '',
        variantId: r.variant_id ?? '',
        sku: r.sku ?? '',
        slug: r.slug,
        title: `${r.brand ?? ''} ${r.name ?? ''}`.trim(),
        titleHi: r.name_hi ? `${r.brand ?? ''} ${r.name_hi}`.trim() : null,
        qty,
        listUnitPaise: priceBySku.get(r.sku ?? '') ?? null,
        mrpPaise: Number(r.mrp_paise ?? 0),
      };
    });
    const listTotalPaise = lineRows.every((l) => l.listUnitPaise !== null)
      ? lineRows.reduce((sum, l) => sum + (l.listUnitPaise ?? 0) * l.qty, 0)
      : null;

    const now = new Date();
    const quote = await insertQuote(tx, place.cityCode, {
      userId: input.userId,
      cityId: place.cityId,
      pincode: input.address.pincode,
      shippingAddress: input.address,
      units,
      listTotalPaise,
      lastMessageAt: note ? now : null,
      lastMessageBy: note ? 'customer' : null,
      expiresAt: inactiveDeadline(now),
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
    });
    await tx.insert(quoteLines).values(lineRows.map((l) => ({ ...l, quoteId: quote.id })));
    if (note)
      await tx.insert(quoteMessages).values({
        quoteId: quote.id,
        authorUserId: input.userId,
        authorRole: 'customer',
        body: note,
      });
    await tx.insert(quoteEvents).values({
      quoteId: quote.id,
      kind: 'requested',
      toStatus: 'open',
      actorType: 'customer',
      actorId: input.userId,
      payload: { lines: lineRows.length, units, listTotalPaise },
    });
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'quote.requested',
      entity: 'quote_request',
      entityId: quote.id,
      after: { code: quote.code, lines: lineRows.length, units },
    });
    await recordServerEvent(tx, 'quote_requested', {
      userId: input.userId,
      cityId: place.cityId,
      props: { quoteCode: quote.code, lines: lineRows.length, units, listTotalPaise },
    });
    return { code: quote.code, status: 'open', version: quote.version, replayed: false };
  });
}

/** Insert with a fresh QT code; a (vanishingly rare) code collision retries in a savepoint. */
async function insertQuote(
  tx: Tx,
  cityCode: string,
  values: Omit<typeof quoteRequests.$inferInsert, 'code'>,
): Promise<{ id: string; code: string; version: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const code = publicCode('QT', cityCode);
    try {
      return await tx.transaction(async (sp) => {
        const [row] = await sp
          .insert(quoteRequests)
          .values({ ...values, code })
          .returning({ id: quoteRequests.id, code: quoteRequests.code, version: quoteRequests.version });
        if (!row) throw new Error('quote insert returned no row');
        return row;
      });
    } catch (err) {
      if (pgCode(err) !== '23505') throw err;
    }
  }
  throw new ConflictError('Could not allocate a quote code, please retry', 'CODE_COLLISION');
}

export function listMyQuotes(
  db: Tx,
  userId: string,
  page: { cursor: string | null; limit?: number },
  _locale: QuoteLocale,
) {
  return summaries(db, sql`q.user_id = ${userId}`, page);
}

export function getMyQuote(db: Tx, userId: string, code: string, locale: QuoteLocale) {
  return detail(db, sql`q.code = ${code} and q.user_id = ${userId}`, locale, false);
}

/** Append a message; serialised by the quote row lock (so the hourly limit counts concurrent sends). */
async function addMessage(
  tx: Tx,
  q: LockedQuote,
  author: { role: 'customer' | 'staff'; userId: string },
  body: string,
): Promise<string> {
  const text = body.trim();
  if (text.length === 0 || text.length > QUOTE_MESSAGE_MAX)
    throw new ValidationError('Write a message of up to 1000 characters', 'QUOTE_MESSAGE_LENGTH');
  const [message] = await tx
    .insert(quoteMessages)
    .values({ quoteId: q.id, authorUserId: author.userId, authorRole: author.role, body: text })
    .returning({ id: quoteMessages.id });
  if (!message) throw new Error('quote message was not stored');
  await tx.insert(quoteEvents).values({
    quoteId: q.id,
    kind: 'message',
    fromStatus: q.status,
    toStatus: q.status,
    actorType: author.role === 'staff' ? 'admin' : 'customer',
    actorId: author.userId,
  });
  await recordServerEvent(tx, 'quote_message_sent', {
    userId: author.userId,
    cityId: q.cityId,
    props: { quoteCode: q.code, by: author.role },
  });
  return message.id;
}

/**
 * The customer writes. On an offered quote this reopens talks (spec 19): the active offer is superseded and the
 * quote goes back to `negotiating`. 30 customer messages per quote per hour.
 */
export async function postCustomerQuoteMessage(
  db: Tx,
  input: { userId: string; code: string; body: string },
): Promise<{ status: QuoteStatus; version: number }> {
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, mineWhere(input.userId, input.code));
    assertOpen(q);
    const recent = await tx.$count(
      quoteMessages,
      and(
        eq(quoteMessages.quoteId, q.id),
        eq(quoteMessages.authorRole, 'customer'),
        gt(quoteMessages.createdAt, new Date(Date.now() - 3_600_000)),
      ),
    );
    if (recent >= QUOTE_CUSTOMER_MESSAGES_PER_HOUR)
      throw new ValidationError('Too many messages on this quote this hour', 'QUOTE_MESSAGE_LIMIT');
    await addMessage(tx, q, { role: 'customer', userId: input.userId }, input.body);
    const now = new Date();
    const touch = { lastMessageAt: now, lastMessageBy: 'customer', expiresAt: inactiveDeadline(now) };
    if (q.status === 'offered') {
      await tx
        .update(quoteOffers)
        .set({ status: 'superseded' })
        .where(and(eq(quoteOffers.quoteId, q.id), eq(quoteOffers.status, 'active')));
      const version = await transition(
        tx,
        q,
        'negotiating',
        { type: 'customer', userId: input.userId },
        touch,
        { reason: 'customer_message', offerVersion: q.offerVersion },
      );
      return { status: 'negotiating', version };
    }
    const [row] = await tx
      .update(quoteRequests)
      .set(touch)
      .where(eq(quoteRequests.id, q.id))
      .returning({ version: quoteRequests.version });
    return { status: q.status, version: row?.version ?? q.version };
  });
}

/**
 * Accept exactly the offer version the customer saw, before it expires: places a normal COD order with the
 * negotiated prices (`placeOrder`, same transaction). The same key returns the same order; any other second accept
 * is QUOTE_CLOSED. Errors: QUOTE_OFFER_STALE, QUOTE_OFFER_EXPIRED (409), and placeOrder's CHECKOUT_UNAVAILABLE,
 * COD_NOT_ALLOWED, ORDERS_BLOCKED, OUT_OF_STOCK — on any of them nothing changes.
 */
export async function acceptQuoteOffer(
  db: Tx,
  input: {
    userId: string;
    code: string;
    offerVersion: number;
    idempotencyKey: string;
    locale: QuoteLocale;
    /** Default cash on delivery. `online` places the order unpaid; the API then opens a Razorpay order for it. */
    paymentMethod?: 'cod' | 'online';
  },
): Promise<{
  orderCode: string;
  totalPaise: number;
  replayed: boolean;
  paymentMethod: 'cod' | 'online';
}> {
  const method = input.paymentMethod ?? 'cod';
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, mineWhere(input.userId, input.code));
    if (q.status === 'accepted') {
      const [group] = await tx
        .select({
          code: orderGroups.code,
          totalPaise: orderGroups.totalPaise,
          key: orderGroups.idempotencyKey,
          method: orderGroups.paymentMethod,
        })
        .from(orderGroups)
        .where(eq(orderGroups.quoteId, q.id));
      if (group?.key === input.idempotencyKey)
        return {
          orderCode: group.code,
          totalPaise: group.totalPaise,
          replayed: true,
          paymentMethod: group.method === 'online' ? 'online' : 'cod',
        };
    }
    assertOpen(q);
    const [offer] = await tx
      .select()
      .from(quoteOffers)
      .where(and(eq(quoteOffers.quoteId, q.id), eq(quoteOffers.status, 'active')))
      .for('update');
    if (q.status !== 'offered' || offer?.offerVersion !== input.offerVersion)
      throw new ConflictError('This offer was replaced; review the latest one', 'QUOTE_OFFER_STALE');
    if (offer.validUntil <= new Date())
      throw new ConflictError('This offer has expired; ask MechDost for a new one', 'QUOTE_OFFER_EXPIRED');
    // Cash on delivery has a ceiling for quote orders too (review I3); above it the customer pays online (the
    // ceiling is a limit on cash at the door, not on card or UPI).
    const capPaise = await settingOr(tx, q.cityId, COD_CAP);
    if (method === 'cod' && offer.totalPaise > capPaise)
      throw new ValidationError(
        'This order is too large for cash on delivery; contact MechDost',
        'QUOTE_COD_CAP',
        {
          capPaise,
        },
      );

    const lines = await tx
      .select({ lineNo: quoteLines.lineNo, sku: quoteLines.sku, qty: quoteLines.qty })
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, q.id))
      .orderBy(asc(quoteLines.lineNo));
    const unitByLine = new Map(offerLines(offer.lines).map((l) => [l.lineNo, l.unitPaise]));
    const unitPaiseBySku = new Map<string, number>();
    for (const l of lines) {
      const unit = unitByLine.get(l.lineNo);
      if (unit === undefined) throw new Error(`offer ${offer.id} has no price for line ${String(l.lineNo)}`);
      unitPaiseBySku.set(l.sku, unit);
    }
    const a = q.shippingAddress;
    const placed = await placeOrder(tx, {
      method,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      address: {
        contactName: a.contactName,
        contactPhone: a.contactPhone,
        line1: a.line1,
        line2: null,
        landmark: a.landmark,
        pincode: a.pincode,
      },
      lines: lines.map((l) => ({ sku: l.sku, qty: l.qty })),
      expectedTotalPaise: offer.totalPaise,
      note: null,
      locale: input.locale,
      quotePricing: { quoteId: q.id, offerId: offer.id, unitPaiseBySku, deliveryPaise: offer.deliveryPaise },
    });
    if (placed.replayed)
      throw new ValidationError(
        'This request key was already used for a different order',
        'IDEMPOTENCY_MISMATCH',
      );

    await tx
      .update(quoteOffers)
      .set({ status: 'accepted', decidedAt: new Date() })
      .where(and(eq(quoteOffers.id, offer.id), eq(quoteOffers.status, 'active')));
    await transition(
      tx,
      q,
      'accepted',
      { type: 'customer', userId: input.userId },
      {},
      {
        offerVersion: offer.offerVersion,
        orderCode: placed.code,
        totalPaise: placed.totalPaise,
      },
    );
    await recordServerEvent(tx, 'quote_accepted', {
      userId: input.userId,
      cityId: q.cityId,
      props: {
        quoteCode: q.code,
        offerVersion: offer.offerVersion,
        orderCode: placed.code,
        totalPaise: placed.totalPaise,
        paymentMethod: method,
      },
    });
    return { orderCode: placed.code, totalPaise: placed.totalPaise, replayed: false, paymentMethod: method };
  });
}

/** The customer closes their quote (any time before accepting), with a reason code. */
export async function declineQuote(
  db: Tx,
  input: { userId: string; code: string; reasonCode: QuoteDeclineReason },
): Promise<{ status: QuoteStatus; version: number }> {
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, mineWhere(input.userId, input.code));
    assertOpen(q);
    await tx
      .update(quoteOffers)
      .set({ status: 'closed' })
      .where(and(eq(quoteOffers.quoteId, q.id), eq(quoteOffers.status, 'active')));
    const version = await transition(
      tx,
      q,
      'declined',
      { type: 'customer', userId: input.userId },
      { statusReasonCode: input.reasonCode },
      { reasonCode: input.reasonCode },
    );
    await recordServerEvent(tx, 'quote_closed', {
      userId: input.userId,
      cityId: q.cityId,
      props: { quoteCode: q.code, to: 'declined', by: 'customer', reasonCode: input.reasonCode },
    });
    return { status: 'declined', version };
  });
}

// ── staff ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** `ADMIN_QUOTE_VIEWS` of `@mechdost/shared/quote-api`, imported as a type only (no Zod at runtime here, L101). */
export type { AdminQuoteView };

const VIEW_FILTER: Record<AdminQuoteView, SQL> = {
  // Needs our reply: a new request, or the customer wrote last.
  waiting: sql`q.status in ('open','negotiating') and (q.status = 'open' or q.last_message_by = 'customer')`,
  active: sql`q.status in ('open','negotiating','offered')`,
  offered: sql`q.status = 'offered'`,
  // Offers that run out within 24 hours (or already ran out and wait for the sweep).
  expiring: sql`q.status = 'offered' and o.valid_until < now() + interval '24 hours'`,
  closed: sql`q.status in ('accepted','declined','expired','withdrawn')`,
};

export function listAdminQuotes(
  db: Tx,
  scope: CityScope,
  view: AdminQuoteView,
  page: { cursor: string | null; limit?: number },
  _locale: QuoteLocale,
) {
  return summaries(db, sql`${scopeSql(scope)} and ${VIEW_FILTER[view]}`, page);
}

export function getAdminQuote(db: Tx, scope: CityScope, code: string, locale: QuoteLocale) {
  return detail(db, sql`q.code = ${code} and ${scopeSql(scope)}`, locale, true);
}

/** Staff reply as MechDost. The first reply moves a new request to `negotiating`; an active offer stays. */
export async function postStaffQuoteMessage(
  db: Tx,
  input: { scope: CityScope; staffUserId: string; code: string; body: string },
): Promise<{ status: QuoteStatus; version: number }> {
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, staffWhere(input.scope, input.code));
    assertOpen(q);
    const messageId = await addMessage(tx, q, { role: 'staff', userId: input.staffUserId }, input.body);
    await queueQuoteWhatsApp(tx, {
      userId: q.userId,
      quoteCode: q.code,
      event: 'quote.message',
      dedupe: messageId,
    });
    const now = new Date();
    const touch = { lastMessageAt: now, lastMessageBy: 'staff', expiresAt: inactiveDeadline(now) };
    if (q.status === 'open') {
      const version = await transition(
        tx,
        q,
        'negotiating',
        { type: 'admin', userId: input.staffUserId },
        touch,
      );
      return { status: 'negotiating', version };
    }
    const [row] = await tx
      .update(quoteRequests)
      .set(touch)
      .where(eq(quoteRequests.id, q.id))
      .returning({ version: quoteRequests.version });
    return { status: q.status, version: row?.version ?? q.version };
  });
}

/**
 * Staff send the final price as a new offer version: a unit price for every line, delivery, validity (days) and
 * terms. The previous active offer is superseded. The price is whatever the negotiation settles (Q20: no discount
 * cap, no second approver); every offer is audited with its discount against the catalogue total. COD only.
 */
export async function sendQuoteOffer(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    code: string;
    expectedVersion: number;
    lines: readonly { lineNo: number; unitPaise: number }[];
    deliveryPaise: number;
    validDays: number;
    terms: string | null;
    /** Staff confirmed prices below the shop price or under a tenth of the list price (review I2). */
    confirmLowPrices?: boolean;
  },
): Promise<{ status: QuoteStatus; version: number; offerVersion: number }> {
  if (
    !Number.isInteger(input.validDays) ||
    input.validDays < QUOTE_OFFER_MIN_DAYS ||
    input.validDays > QUOTE_OFFER_MAX_DAYS
  )
    throw new ValidationError('An offer is valid for 1 to 30 days', 'QUOTE_OFFER_VALIDITY');
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, staffWhere(input.scope, input.code));
    assertOpen(q);
    if (q.version !== input.expectedVersion)
      throw new ConflictError('This quote changed; reload and try again', 'STALE_QUOTE');
    const lines = await tx
      .select({ lineNo: quoteLines.lineNo, qty: quoteLines.qty, listUnitPaise: quoteLines.listUnitPaise })
      .from(quoteLines)
      .where(eq(quoteLines.quoteId, q.id))
      .orderBy(asc(quoteLines.lineNo));
    const price = new Map(input.lines.map((l) => [l.lineNo, l.unitPaise]));
    if (
      price.size !== input.lines.length ||
      input.lines.length !== lines.length ||
      lines.some((l) => !price.has(l.lineNo)) ||
      input.lines.some((l) => !Number.isSafeInteger(l.unitPaise) || l.unitPaise <= 0)
    )
      throw new ValidationError('Give a price for every line', 'QUOTE_OFFER_LINES');
    if (!Number.isSafeInteger(input.deliveryPaise) || input.deliveryPaise < 0)
      throw new ValidationError('Delivery must be zero or more', 'QUOTE_OFFER_DELIVERY');
    const priced = lines.map((l) => ({ lineNo: l.lineNo, qty: l.qty, unitPaise: price.get(l.lineNo) ?? 0 }));
    const { subtotalPaise, totalPaise } = quoteOfferTotal(priced, input.deliveryPaise);
    // Guard against slips (rupees typed as paise, a missing zero): a price below what the shop is paid, or under a
    // tenth of the list price, needs an explicit confirmation (review I2). The price itself stays free (Q20).
    const costs = await lineCosts(tx, q.id, q.shippingAddress.pincode);
    const belowCost = priced
      .filter((l) => {
        const cost = costs.get(l.lineNo)?.costPaise;
        return cost !== undefined && cost !== null && l.unitPaise < cost;
      })
      .map((l) => l.lineNo);
    const belowTenthOfList = priced
      .filter((l) => {
        const list = lines.find((x) => x.lineNo === l.lineNo)?.listUnitPaise;
        return list !== undefined && list !== null && l.unitPaise * 10 < list;
      })
      .map((l) => l.lineNo);
    if ((belowCost.length > 0 || belowTenthOfList.length > 0) && input.confirmLowPrices !== true)
      throw new ValidationError('Confirm the prices below the shop price', 'QUOTE_OFFER_CONFIRM_LOW', {
        belowCost,
        belowTenthOfList,
      });

    await tx
      .update(quoteOffers)
      .set({ status: 'superseded' })
      .where(and(eq(quoteOffers.quoteId, q.id), eq(quoteOffers.status, 'active')));
    const offerVersion = q.offerVersion + 1;
    const now = new Date();
    const validUntil = new Date(now.getTime() + input.validDays * DAY_MS);
    await tx.insert(quoteOffers).values({
      quoteId: q.id,
      offerVersion,
      lines: priced.map(({ lineNo, unitPaise }) => ({ lineNo, unitPaise })),
      subtotalPaise,
      deliveryPaise: input.deliveryPaise,
      totalPaise,
      listTotalPaise: q.listTotalPaise,
      paymentMethod: 'cod',
      validUntil,
      terms: input.terms?.trim() ? input.terms.trim() : null,
      createdBy: input.staffUserId,
      createdAt: now,
    });
    const set = { offerVersion, expiresAt: new Date(validUntil.getTime() + QUOTE_INACTIVE_DAYS * DAY_MS) };
    const payload = {
      offerVersion,
      totalPaise,
      listTotalPaise: q.listTotalPaise,
      validDays: input.validDays,
    };
    let version: number;
    if (q.status === 'offered') {
      // A revised offer: same status, new version (compare-and-set on the version read above).
      const [row] = await tx
        .update(quoteRequests)
        .set(set)
        .where(and(eq(quoteRequests.id, q.id), eq(quoteRequests.version, q.version)))
        .returning({ version: quoteRequests.version });
      if (!row) throw new ConflictError('This quote changed; reload and try again', 'STALE_QUOTE');
      version = row.version;
      await tx.insert(quoteEvents).values({
        quoteId: q.id,
        kind: 'offer',
        fromStatus: 'offered',
        toStatus: 'offered',
        actorType: 'admin',
        actorId: input.staffUserId,
        payload,
      });
      await tx.insert(auditLog).values({
        actorUserId: input.staffUserId,
        actorRole: 'staff',
        action: 'quote.offer_sent',
        entity: 'quote_request',
        entityId: q.id,
        after: payload,
      });
    } else {
      version = await transition(
        tx,
        q,
        'offered',
        { type: 'admin', userId: input.staffUserId },
        set,
        payload,
      );
    }
    await recordServerEvent(tx, 'quote_offer_sent', {
      userId: input.staffUserId,
      cityId: q.cityId,
      props: { quoteCode: q.code, ...payload },
    });
    await queueOfferEmail(tx, q, offerVersion, validUntil);
    await queueQuoteWhatsApp(tx, {
      userId: q.userId,
      quoteCode: q.code,
      event: 'quote.offer_sent',
      dedupe: `${q.id}:o${String(offerVersion)}`,
    });
    return { status: 'offered', version, offerVersion };
  });
}

/** Email the customer that a price is ready (only to a verified address; the dedupe key is per offer version). */
async function queueOfferEmail(tx: Tx, q: LockedQuote, offerVersion: number, validUntil: Date) {
  await queueEmail(tx, {
    template: 'quote_offer',
    entityId: q.id,
    version: offerVersion,
    userId: q.userId,
    payload: { quoteCode: q.code, validUntil: istDateString(validUntil) },
  });
}

/**
 * "Your offer ends soon" (design 2026-11-15): one email per active offer whose validity ends within `hoursAhead`
 * (24 by default), queued by the worker's quote sweep. One transaction per offer, dedupe key per offer id, so a
 * re-run or a second worker never sends twice. Only offers of still-offered quotes (open to accept) count.
 */
export async function queueQuoteExpiringEmails(
  db: Tx,
  opts: { hoursAhead?: number; limit?: number } = {},
): Promise<number> {
  const hours = Math.min(Math.max(Math.floor(opts.hoursAhead ?? 24), 1), 72);
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const due = rowsOf<{ offer_id: string; code: string; user_id: string; valid_until: string | Date }>(
    await db.execute(sql`
      select o.id as offer_id, q.code, q.user_id, o.valid_until
      from quote_offers o join quote_requests q on q.id = o.quote_id
      where o.status = 'active' and q.status = 'offered'
        and o.valid_until > now() and o.valid_until <= now() + make_interval(hours => ${hours})
      order by o.valid_until
      limit ${limit}`),
  );
  let queued = 0;
  for (const r of due) {
    const sent = await db.transaction(async (tx) => {
      // The WhatsApp reminder shares the sweep; its own dedupe key (offer id) keeps it to one per offer.
      await queueQuoteWhatsApp(tx, {
        userId: r.user_id,
        quoteCode: r.code,
        event: 'quote.expiring',
        dedupe: r.offer_id,
      });
      return queueEmail(tx, {
        template: 'quote_expiring',
        entityId: r.offer_id,
        version: 1,
        userId: r.user_id,
        payload: { quoteCode: r.code, validUntil: istDateString(new Date(r.valid_until)) },
      });
    });
    if (sent) queued += 1;
  }
  return queued;
}

/** Staff close a quote they cannot fulfil, with a reason code and a message the customer sees. */
export async function withdrawQuote(
  db: Tx,
  input: {
    scope: CityScope;
    staffUserId: string;
    code: string;
    expectedVersion: number;
    reasonCode: QuoteWithdrawReason;
    message: string;
  },
): Promise<{ status: QuoteStatus; version: number }> {
  const message = input.message.trim();
  if (message.length < 10 || message.length > 500)
    throw new ValidationError('Write 10 to 500 characters for the customer', 'QUOTE_WITHDRAW_MESSAGE');
  return db.transaction(async (tx) => {
    const q = await lockQuote(tx, staffWhere(input.scope, input.code));
    assertOpen(q);
    if (q.version !== input.expectedVersion)
      throw new ConflictError('This quote changed; reload and try again', 'STALE_QUOTE');
    await tx
      .update(quoteOffers)
      .set({ status: 'closed' })
      .where(and(eq(quoteOffers.quoteId, q.id), eq(quoteOffers.status, 'active')));
    const version = await transition(
      tx,
      q,
      'withdrawn',
      { type: 'admin', userId: input.staffUserId },
      { statusReasonCode: input.reasonCode, closingMessage: message },
      { reasonCode: input.reasonCode },
    );
    await recordServerEvent(tx, 'quote_closed', {
      userId: input.staffUserId,
      cityId: q.cityId,
      props: { quoteCode: q.code, to: 'withdrawn', by: 'staff', reasonCode: input.reasonCode },
    });
    await queueQuoteWhatsApp(tx, {
      userId: q.userId,
      quoteCode: q.code,
      event: 'quote.withdrawn',
      dedupe: q.id,
    });
    return { status: 'withdrawn', version };
  });
}

// ── worker ────────────────────────────────────────────────────────────────────────────────────────────────────

export interface QuoteSweepFailure {
  quoteId: string;
  /** SQLSTATE or the domain error code — never the error text (it may quote data). */
  code: string;
}

/**
 * The quote sweep (worker, every few minutes). An active offer that ran out is marked `expired` and the quote goes
 * back to `negotiating`, so the customer can ask for a new offer (ruling 2026-11-14). A quote nobody wrote on until
 * `expires_at` closes as `expired` (`inactive`). One short transaction per quote (row locked first), so several
 * workers may run this safely; `skip` lets the worker back off quotes that keep failing.
 */
export async function expireQuotes(
  db: Tx,
  opts: { limit?: number; skip?: ReadonlySet<string> } = {},
): Promise<{ offersExpired: number; expired: number; failed: QuoteSweepFailure[] }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const skip = [...(opts.skip ?? [])];
  const due = rowsOf<{ id: string }>(
    await db.execute(sql`
      select q.id from quote_requests q
      where q.status in ('open','negotiating','offered')
        and (q.expires_at <= now()
          or (q.status = 'offered' and exists (
            select 1 from quote_offers o where o.quote_id = q.id and o.status = 'active' and o.valid_until <= now())))
        ${
          skip.length > 0
            ? sql`and q.id not in (${sql.join(
                skip.map((id) => sql`${id}::uuid`),
                sql`, `,
              )})`
            : sql``
        }
      order by q.id
      limit ${limit}`),
  );
  let offersExpired = 0;
  let expired = 0;
  const failed: QuoteSweepFailure[] = [];
  for (const { id } of due) {
    try {
      const done = await db.transaction(async (tx) => {
        const q = await lockQuote(tx, eq(quoteRequests.id, id));
        if (!OPEN.includes(q.status)) return null;
        const now = new Date();
        const [row] = await tx
          .select({ expiresAt: quoteRequests.expiresAt })
          .from(quoteRequests)
          .where(eq(quoteRequests.id, q.id));
        if (row && row.expiresAt <= now) {
          const reason: QuoteExpireReason = 'inactive';
          await tx
            .update(quoteOffers)
            .set({ status: 'closed' })
            .where(and(eq(quoteOffers.quoteId, q.id), eq(quoteOffers.status, 'active')));
          await transition(
            tx,
            q,
            'expired',
            { type: 'system', userId: null },
            { statusReasonCode: reason },
            {
              reasonCode: reason,
            },
          );
          await recordServerEvent(tx, 'quote_expired', {
            cityId: q.cityId,
            props: { quoteCode: q.code, reasonCode: reason, offerVersion: q.offerVersion },
          });
          return 'quote' as const;
        }
        if (q.status !== 'offered') return null;
        const ranOut = await tx
          .update(quoteOffers)
          .set({ status: 'expired' })
          .where(
            and(
              eq(quoteOffers.quoteId, q.id),
              eq(quoteOffers.status, 'active'),
              sql`${quoteOffers.validUntil} <= now()`,
            ),
          )
          .returning({ offerVersion: quoteOffers.offerVersion });
        if (ranOut.length === 0) return null;
        await transition(
          tx,
          q,
          'negotiating',
          { type: 'system', userId: null },
          {},
          {
            reason: 'offer_expired',
            offerVersion: q.offerVersion,
          },
        );
        await recordServerEvent(tx, 'quote_offer_expired', {
          cityId: q.cityId,
          props: { quoteCode: q.code, offerVersion: q.offerVersion },
        });
        return 'offer' as const;
      });
      if (done === 'quote') expired += 1;
      if (done === 'offer') offersExpired += 1;
    } catch (err) {
      const domain = (err as { code?: unknown }).code;
      failed.push({
        quoteId: id,
        code:
          pgCode(err) ?? (typeof domain === 'string' ? domain : err instanceof Error ? err.name : 'UNKNOWN'),
      });
    }
  }
  return { offersExpired, expired, failed };
}
