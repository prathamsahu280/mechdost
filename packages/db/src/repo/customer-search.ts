import { and, desc, eq, inArray, isNull, like, sql } from 'drizzle-orm';
import { maskEmail, maskPhone, searchKind, type SearchKind } from '@mechdost/shared/contact-mask';
import {
  auditLog,
  coinAccounts,
  consents,
  orderGroups,
  orders,
  refunds,
  serviceRequests,
  supportTickets,
  users,
} from '../schema';
import { NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';

/**
 * Customer search and view for staff (design 2026-11-15, specs 08/13). Every lookup is bounded by an index: phone by
 * its last 10 digits (`users_phone_last10_idx`), email by the citext unique index, name by prefix
 * (`users_name_prefix_idx`), codes by their unique indexes. Results are capped at 20 and always masked; the view
 * unmasks contact details only for `customers:read_pii` and writes an audit row for each such view.
 */
export const SEARCH_LIMIT = 20;
const SECTION_LIMIT = 20;

export interface CustomerSearchResult {
  id: string;
  name: string | null;
  phoneMasked: string | null;
  emailMasked: string | null;
  status: string;
  createdAt: Date;
}

/** `%`, `_` and `\` in a typed name are literal characters, not wildcards. */
const likeEscape = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

async function codeOwners(db: Tx, code: string): Promise<string[]> {
  const prefix = code.split('-')[0];
  const rows =
    prefix === 'SR'
      ? await db
          .select({ id: serviceRequests.userId })
          .from(serviceRequests)
          .where(eq(serviceRequests.code, code))
      : prefix === 'REQ'
        ? await db
            .select({ id: supportTickets.userId })
            .from(supportTickets)
            .where(eq(supportTickets.code, code))
        : [
            ...(await db.select({ id: orders.userId }).from(orders).where(eq(orders.code, code))),
            ...(await db
              .select({ id: orderGroups.userId })
              .from(orderGroups)
              .where(eq(orderGroups.code, code))),
          ];
  return [...new Set(rows.flatMap((r) => (r.id ? [r.id] : [])))];
}

export async function searchCustomers(
  db: Tx,
  input: { q: string },
): Promise<{ kind: SearchKind; results: CustomerSearchResult[] }> {
  const parsed = searchKind(input.q);
  if (!parsed)
    throw new ValidationError(
      'Search by phone (10 digits), email, order, request or ticket code, or the start of a name',
      'SEARCH_QUERY',
    );
  const { kind, value } = parsed;
  const live = isNull(users.deletedAt);
  let where;
  if (kind === 'code') {
    const ids = await codeOwners(db, value);
    if (ids.length === 0) return { kind, results: [] };
    where = and(live, inArray(users.id, ids));
  } else if (kind === 'email') where = and(live, eq(users.email, value));
  else if (kind === 'phone') where = and(live, sql`right(${users.phone}, 10) = ${value}`);
  else where = and(live, like(sql`lower(${users.name})`, `${likeEscape(value)}%`));
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      phone: users.phone,
      email: users.email,
      status: users.status,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(SEARCH_LIMIT);
  return {
    kind,
    results: rows.map((r) => ({
      id: r.id,
      name: r.name,
      phoneMasked: maskPhone(r.phone),
      emailMasked: maskEmail(r.email),
      status: r.status,
      createdAt: r.createdAt,
    })),
  };
}

export interface CustomerViewSections {
  orders: boolean;
  serviceRequests: boolean;
  tickets: boolean;
  refunds: boolean;
  coins: boolean;
}

export interface CustomerView {
  profile: {
    id: string;
    name: string | null;
    phone: string | null;
    email: string | null;
    masked: boolean;
    phoneVerified: boolean;
    emailVerified: boolean;
    status: string;
    language: string;
    createdAt: Date;
  };
  orders: { code: string; status: string; totalPaise: number; at: Date }[] | null;
  serviceRequests: { code: string; status: string; at: Date }[] | null;
  tickets: { code: string; status: string; at: Date }[] | null;
  refunds: { id: string; amountPaise: number; status: string; at: Date }[] | null;
  coins: { balance: number; lifetimeEarned: number } | null;
  consents: { purpose: string; granted: boolean; at: Date }[];
}

/**
 * One customer for staff. `sections` says which lists the viewer's role may read (the API derives it from
 * `orders:read`, `service:read`, `tickets:read`, `refunds:read`, `coins:read`); an unreadable section is null.
 * With `canReadPii` the profile is unmasked and the view is audited (who looked, when) in the same transaction.
 */
export async function customerView(
  db: Tx,
  input: { customerId: string; viewerId: string; canReadPii: boolean; sections: CustomerViewSections },
): Promise<CustomerView> {
  return db.transaction(async (tx) => {
    const [u] = await tx
      .select()
      .from(users)
      .where(and(eq(users.id, input.customerId), isNull(users.deletedAt)));
    if (!u) throw new NotFoundError('Customer not found');
    const { sections } = input;
    const [orderRows, srRows, ticketRows, refundRows, coinRows, consentRows] = await Promise.all([
      sections.orders
        ? tx
            .select({
              code: orders.code,
              status: orders.status,
              totalPaise: orders.totalPaise,
              at: orders.placedAt,
            })
            .from(orders)
            .where(eq(orders.userId, u.id))
            .orderBy(desc(orders.placedAt), desc(orders.id))
            .limit(SECTION_LIMIT)
        : null,
      sections.serviceRequests
        ? tx
            .select({
              code: serviceRequests.code,
              status: serviceRequests.status,
              at: serviceRequests.createdAt,
            })
            .from(serviceRequests)
            .where(eq(serviceRequests.userId, u.id))
            .orderBy(desc(serviceRequests.createdAt), desc(serviceRequests.id))
            .limit(SECTION_LIMIT)
        : null,
      sections.tickets
        ? tx
            .select({
              code: supportTickets.code,
              status: supportTickets.status,
              at: supportTickets.createdAt,
            })
            .from(supportTickets)
            .where(eq(supportTickets.userId, u.id))
            .orderBy(desc(supportTickets.createdAt), desc(supportTickets.id))
            .limit(SECTION_LIMIT)
        : null,
      sections.refunds
        ? tx
            .select({
              id: refunds.id,
              amountPaise: refunds.amountPaise,
              status: refunds.status,
              at: refunds.createdAt,
            })
            .from(refunds)
            .innerJoin(orderGroups, eq(orderGroups.id, refunds.groupId))
            .where(eq(orderGroups.userId, u.id))
            .orderBy(desc(refunds.createdAt), desc(refunds.id))
            .limit(SECTION_LIMIT)
        : null,
      sections.coins
        ? tx
            .select({ balance: coinAccounts.balance, lifetimeEarned: coinAccounts.lifetimeEarned })
            .from(coinAccounts)
            .where(eq(coinAccounts.userId, u.id))
        : null,
      tx
        .selectDistinctOn([consents.purpose], {
          purpose: consents.purpose,
          granted: consents.granted,
          at: consents.createdAt,
        })
        .from(consents)
        .where(eq(consents.userId, u.id))
        .orderBy(consents.purpose, desc(consents.createdAt), desc(consents.id)),
    ]);
    if (input.canReadPii) {
      await tx.insert(auditLog).values({
        actorUserId: input.viewerId,
        actorRole: 'staff',
        action: 'customer.pii_viewed',
        entity: 'user',
        entityId: u.id,
      });
    }
    await recordServerEvent(tx, 'admin_customer_viewed', {
      userId: input.viewerId,
      props: { customerId: u.id, unmasked: input.canReadPii },
    });
    return {
      profile: {
        id: u.id,
        name: u.name,
        phone: input.canReadPii ? u.phone : maskPhone(u.phone),
        email: input.canReadPii ? u.email : maskEmail(u.email),
        masked: !input.canReadPii,
        phoneVerified: u.phoneVerifiedAt !== null,
        emailVerified: u.emailVerifiedAt !== null,
        status: u.status,
        language: u.language,
        createdAt: u.createdAt,
      },
      orders: orderRows,
      serviceRequests: srRows,
      tickets: ticketRows,
      refunds: refundRows,
      coins: coinRows ? (coinRows[0] ?? { balance: 0, lifetimeEarned: 0 }) : null,
      consents: consentRows,
    };
  });
}
