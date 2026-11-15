import { and, eq, sql } from 'drizzle-orm';
import {
  WAITLIST_MAX_ACTIVE,
  type WaitlistDemand,
  type WaitlistEntry,
  type WaitlistState,
} from '@mechdost/shared/waitlist';
import { auditLog, pincodeWaitlist } from '../schema';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from './errors';
import { recordServerEvent } from './events';
import { queueNotice } from './notices';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { num, rowsOf } from './sql-rows';

/**
 * "Notify me" for a PIN MechDost does not serve (spec 15 waitlist, design 2026-11-15 item 7). Own data only: the
 * user id is the session's. Joining needs a verified phone or email on the account (the notice goes to the account;
 * nobody can make MechDost message an address they typed). A PIN that is served now is refused; joining twice is one
 * row; at most `WAITLIST_MAX_ACTIVE` waits per person (checked under a lock on the user row, so two quick taps cannot
 * pass the limit). The worker tells each person once, in the bell (and push, when they allowed it), when the PIN is
 * switched on. Counts per PIN, for the launch checklist, come from `waitlistDemand`.
 */

/** A PIN is served when it is in the PIN table, switched on, and its city is live (same rule as the catalogue). */
const SERVED = sql`exists (select 1 from pincodes pc join cities c on c.id = pc.city_id
  where pc.pincode = w.pincode and pc.active and c.status = 'live')`;

type Row = typeof pincodeWaitlist.$inferSelect;

function toEntry(r: Row): WaitlistEntry {
  return {
    pincode: r.pincode,
    status: r.status as WaitlistState,
    createdAt: r.createdAt.toISOString(),
    notifiedAt: r.notifiedAt?.toISOString() ?? null,
  };
}

export async function listMyWaitlist(tx: Tx, userId: string): Promise<WaitlistEntry[]> {
  const rows = await tx
    .select()
    .from(pincodeWaitlist)
    .where(eq(pincodeWaitlist.userId, userId))
    .orderBy(pincodeWaitlist.createdAt, pincodeWaitlist.id)
    .limit(50);
  return rows.map(toEntry);
}

export async function joinWaitlist(
  db: Tx,
  input: { userId: string; pincode: string },
): Promise<WaitlistEntry> {
  return db.transaction(async (tx) => {
    const [user] = rowsOf<{ ok: boolean }>(
      await tx.execute(sql`select (phone_verified_at is not null or email_verified_at is not null) as ok
        from users where id = ${input.userId}::uuid and deleted_at is null and status = 'active' for update`),
    );
    if (!user) throw new NotFoundError('Account not found');
    if (!user.ok) throw new ForbiddenError('Verify your phone or email first', 'CONTACT_NOT_VERIFIED');
    const [served] = rowsOf<{ served: boolean }>(
      await tx.execute(sql`select exists (select 1 from pincodes pc join cities c on c.id = pc.city_id
        where pc.pincode = ${input.pincode} and pc.active and c.status = 'live') as served`),
    );
    if (served?.served)
      throw new ConflictError('MechDost already serves this PIN code', 'ALREADY_SERVICEABLE');

    const [existing] = await tx
      .select()
      .from(pincodeWaitlist)
      .where(and(eq(pincodeWaitlist.userId, input.userId), eq(pincodeWaitlist.pincode, input.pincode)));
    if (existing?.status === 'waiting') return toEntry(existing);

    const [{ n } = { n: 0 }] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(pincodeWaitlist)
      .where(and(eq(pincodeWaitlist.userId, input.userId), eq(pincodeWaitlist.status, 'waiting')));
    if (n >= WAITLIST_MAX_ACTIVE)
      throw new ValidationError('You can wait for up to five PIN codes at a time', 'WAITLIST_FULL');

    const [row] = existing
      ? await tx
          .update(pincodeWaitlist)
          .set({ status: 'waiting', notifiedAt: null })
          .where(eq(pincodeWaitlist.id, existing.id))
          .returning()
      : await tx.insert(pincodeWaitlist).values({ userId: input.userId, pincode: input.pincode }).returning();
    if (!row) throw new Error('waitlist write returned no row');
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'waitlist.joined',
      entity: 'pincode_waitlist',
      entityId: row.id,
      after: { pincode: input.pincode },
    });
    await recordServerEvent(tx, 'waitlist_joined', {
      userId: input.userId,
      props: { pincode: input.pincode },
    });
    return toEntry(row);
  });
}

export async function leaveWaitlist(db: Tx, input: { userId: string; pincode: string }): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .update(pincodeWaitlist)
      .set({ status: 'cancelled', notifiedAt: null })
      .where(
        and(
          eq(pincodeWaitlist.userId, input.userId),
          eq(pincodeWaitlist.pincode, input.pincode),
          eq(pincodeWaitlist.status, 'waiting'),
        ),
      )
      .returning({ id: pincodeWaitlist.id });
    const row = rows[0];
    if (!row) throw new NotFoundError('You are not waiting for this PIN code');
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'waitlist.left',
      entity: 'pincode_waitlist',
      entityId: row.id,
      after: { pincode: input.pincode },
    });
    await recordServerEvent(tx, 'waitlist_left', { userId: input.userId, props: { pincode: input.pincode } });
  });
}

/**
 * Launch checklist (spec 15): PINs with customers waiting, most wanted first, with the city and area when the PIN is
 * listed. A city-scoped staff member sees the PINs of their cities only; PINs MechDost has not listed (no city)
 * belong to all-cities staff.
 */
export async function waitlistDemand(tx: Tx, scope: CityScope): Promise<WaitlistDemand> {
  const scoped = scope.all
    ? sql`true`
    : scope.cityIds.length === 0
      ? sql`false`
      : sql`pc.city_id in (${sql.join(
          scope.cityIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`;
  const rows = rowsOf<{
    pincode: string;
    city_code: string | null;
    area: string | null;
    area_hi: string | null;
    waiting: number | string;
    notified: number | string;
    served: boolean | null;
    oldest: Date | string;
  }>(
    await tx.execute(sql`
      select w.pincode, c.code as city_code, pc.locality as area, pc.locality_hi as area_hi,
        count(*) filter (where w.status = 'waiting') as waiting,
        count(*) filter (where w.status = 'notified') as notified,
        (pc.active and c.status = 'live') as served,
        min(w.created_at) filter (where w.status = 'waiting') as oldest
      from pincode_waitlist w
      left join pincodes pc on pc.pincode = w.pincode
      left join cities c on c.id = pc.city_id
      where w.status in ('waiting', 'notified') and ${scoped}
      group by w.pincode, c.code, pc.locality, pc.locality_hi, pc.active, c.status
      having count(*) filter (where w.status = 'waiting') > 0
      order by waiting desc, oldest, w.pincode
      limit 200`),
  );
  const out = rows.map((r) => ({
    pincode: r.pincode,
    cityCode: r.city_code,
    area: r.area,
    areaHi: r.area_hi,
    waiting: num(r.waiting),
    notified: num(r.notified),
    servedNow: r.served === true,
    oldestAt: new Date(r.oldest).toISOString(),
  }));
  return { rows: out, totalWaiting: out.reduce((sum, r) => sum + r.waiting, 0) };
}

/**
 * Worker: for waiting rows whose PIN is now served, writes the bell notice (and push, per the person's choices) and
 * marks the row notified in the same transaction, so each person is told once. Deactivated accounts keep waiting.
 */
export async function notifyServedWaitlist(db: Tx, opts: { batch?: number }): Promise<number> {
  const due = rowsOf<{ id: string; user_id: string; pincode: string }>(
    await db.execute(sql`
      select w.id, w.user_id, w.pincode from pincode_waitlist w join users u on u.id = w.user_id
      where w.status = 'waiting' and u.status = 'active' and u.deleted_at is null and ${SERVED}
      order by w.created_at, w.id limit ${opts.batch ?? 200}`),
  );
  let told = 0;
  for (const w of due) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .update(pincodeWaitlist)
        .set({ status: 'notified', notifiedAt: new Date() })
        .where(and(eq(pincodeWaitlist.id, w.id), eq(pincodeWaitlist.status, 'waiting')))
        .returning({ id: pincodeWaitlist.id });
      if (rows.length === 0) return;
      await queueNotice(tx, {
        kind: 'account.pin_served',
        userId: w.user_id,
        entityId: w.id,
        version: 1,
        params: { pincode: w.pincode },
      });
      await recordServerEvent(tx, 'waitlist_notified', { userId: w.user_id, props: { pincode: w.pincode } });
      told += 1;
    });
  }
  return told;
}
