import { and, desc, eq, lte, sql, type SQL } from 'drizzle-orm';
import { MARKETING_NOTICE_VERSION } from '@mechdost/shared/notice-api';
import { CONSENT_NOTICE_VERSION } from '@mechdost/shared/privacy';
import {
  EXPORT_COOLDOWN_HOURS,
  EXPORT_FORMAT_VERSION,
  EXPORT_MAX_BYTES,
  EXPORT_ROWS_PER_KIND,
  EXPORT_TTL_HOURS,
  PRIVACY_PURPOSES,
  type ConsentView,
  type ExportStatus,
  type PrivacyPurpose,
  type PrivacyView,
} from '@mechdost/shared/privacy-api';
import { auditLog, consents, dataExportRequests } from '../schema';
import { ConflictError, NotFoundError, pgCode } from './errors';
import { recordServerEvent } from './events';
import { setNoticePreferences } from './notices';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/**
 * Account -> Privacy (DPDP; design 2026-11-15 item 6, spec 01). Everything here is the signed-in person's own data:
 * the user id comes from the session, never from the URL or body, and another person's export id is a 404.
 *
 * Consents are append-only rows (`consents`, trigger `consents_append_only`); granting or withdrawing writes a new row
 * only when the answer changes. Withdrawal is effective at once for what uses the purpose: `marketing` turns the
 * promotional notice preferences off (same path as Account -> Notifications), `analytics` is read by the browser
 * (it stops sending events as soon as the page saves the choice).
 *
 * The export is a request row; the worker builds the JSON (`buildDueDataExports`, bounded to `EXPORT_MAX_BYTES`),
 * the owner downloads it through the authenticated API until `expires_at`, and the worker clears the file
 * (`expireDataExports`). One active export per person, one new request per `EXPORT_COOLDOWN_HOURS`.
 */

const HOUR_MS = 3_600_000;

const NOTICE_VERSION: Record<PrivacyPurpose, string> = {
  marketing: MARKETING_NOTICE_VERSION,
  analytics: CONSENT_NOTICE_VERSION,
};

// ── Consents ─────────────────────────────────────────────────────────────────────────────────────────────

async function consentViews(tx: Tx, userId: string): Promise<ConsentView[]> {
  const rows = await tx
    .selectDistinctOn([consents.purpose], {
      purpose: consents.purpose,
      granted: consents.granted,
      at: consents.createdAt,
      noticeVersion: consents.noticeVersion,
    })
    .from(consents)
    .where(eq(consents.userId, userId))
    .orderBy(consents.purpose, desc(consents.createdAt), desc(consents.id));
  return PRIVACY_PURPOSES.map((purpose) => {
    const row = rows.find((r) => r.purpose === purpose);
    return {
      purpose,
      granted: row?.granted ?? null,
      at: row ? row.at.toISOString() : null,
      noticeVersion: row?.noticeVersion ?? null,
    };
  });
}

/** Grant or withdraw one purpose; returns the person's choices as they are now. */
export async function setConsent(
  db: Tx,
  input: { userId: string; purpose: PrivacyPurpose; granted: boolean },
): Promise<ConsentView[]> {
  return db.transaction(async (tx) => {
    const version = NOTICE_VERSION[input.purpose];
    if (input.purpose === 'marketing') {
      await setNoticePreferences(tx, input.userId, { promotions: input.granted }, version, 'account_privacy');
    } else {
      const [latest] = await tx
        .select({ granted: consents.granted })
        .from(consents)
        .where(and(eq(consents.userId, input.userId), eq(consents.purpose, input.purpose)))
        .orderBy(desc(consents.createdAt), desc(consents.id))
        .limit(1);
      if (latest?.granted !== input.granted) {
        await tx.insert(consents).values({
          userId: input.userId,
          purpose: input.purpose,
          granted: input.granted,
          noticeVersion: version,
          source: 'account_privacy',
        });
        await recordServerEvent(tx, 'consent_changed', {
          userId: input.userId,
          props: { purpose: input.purpose, granted: input.granted, noticeVersion: version },
        });
      }
    }
    return consentViews(tx, input.userId);
  });
}

// ── Export: request, build, download, expire ────────────────────────────────────────────────────────────

type ExportRow = typeof dataExportRequests.$inferSelect;

function toStatus(r: ExportRow): ExportStatus {
  return {
    id: r.id,
    status: r.status as ExportStatus['status'],
    requestedAt: r.createdAt.toISOString(),
    readyAt: r.readyAt?.toISOString() ?? null,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    bytes: r.payloadBytes,
  };
}

async function latestExport(tx: Tx, userId: string): Promise<ExportRow | undefined> {
  const [row] = await tx
    .select()
    .from(dataExportRequests)
    .where(eq(dataExportRequests.userId, userId))
    .orderBy(desc(dataExportRequests.createdAt), desc(dataExportRequests.id))
    .limit(1);
  return row;
}

/** A new request is possible when none is active and the last one that was not a failure is old enough. */
async function exportBlock(
  tx: Tx,
  userId: string,
  now: Date,
): Promise<'EXPORT_ACTIVE' | 'EXPORT_TOO_SOON' | null> {
  const rows = await tx
    .select({ status: dataExportRequests.status, createdAt: dataExportRequests.createdAt })
    .from(dataExportRequests)
    .where(eq(dataExportRequests.userId, userId))
    .orderBy(desc(dataExportRequests.createdAt))
    .limit(5);
  if (rows.some((r) => r.status === 'requested' || r.status === 'ready')) return 'EXPORT_ACTIVE';
  const last = rows.find((r) => r.status !== 'failed');
  if (last && now.getTime() - last.createdAt.getTime() < EXPORT_COOLDOWN_HOURS * HOUR_MS)
    return 'EXPORT_TOO_SOON';
  return null;
}

export async function getPrivacyView(tx: Tx, userId: string, now = new Date()): Promise<PrivacyView> {
  const [views, latest, block] = await Promise.all([
    consentViews(tx, userId),
    latestExport(tx, userId),
    exportBlock(tx, userId, now),
  ]);
  return { consents: views, export: latest ? toStatus(latest) : null, canRequestExport: block === null };
}

export async function requestDataExport(
  db: Tx,
  input: { userId: string; now?: Date },
): Promise<ExportStatus> {
  const now = input.now ?? new Date();
  try {
    return await db.transaction(async (tx) => {
      const block = await exportBlock(tx, input.userId, now);
      if (block === 'EXPORT_ACTIVE')
        throw new ConflictError('You already have a data download in progress', block);
      if (block === 'EXPORT_TOO_SOON')
        throw new ConflictError('You can ask for a new data download once a day', block);
      const [row] = await tx.insert(dataExportRequests).values({ userId: input.userId }).returning();
      if (!row) throw new Error('export insert returned no row');
      await tx.insert(auditLog).values({
        actorUserId: input.userId,
        actorRole: 'customer',
        action: 'data_export.requested',
        entity: 'data_export',
        entityId: row.id,
      });
      await recordServerEvent(tx, 'data_export_requested', {
        userId: input.userId,
        props: { exportId: row.id },
      });
      return toStatus(row);
    });
  } catch (err) {
    // Two taps at once: the partial unique index lets only one active request in.
    if (pgCode(err) === '23505')
      throw new ConflictError('You already have a data download in progress', 'EXPORT_ACTIVE');
    throw err;
  }
}

interface Section {
  rows: unknown[];
  truncated: boolean;
}

/** Up to `EXPORT_ROWS_PER_KIND` rows of one kind; one more is read only to know whether the list was cut. */
async function section(tx: Tx, query: SQL): Promise<Section> {
  const rows = rowsOf<unknown>(await tx.execute(sql`${query} limit ${EXPORT_ROWS_PER_KIND + 1}`));
  return { rows: rows.slice(0, EXPORT_ROWS_PER_KIND), truncated: rows.length > EXPORT_ROWS_PER_KIND };
}

/**
 * What MechDost holds about the person, as plain JSON (their profile, addresses, vehicles, consents, orders with
 * lines, service requests, support request headers, reviews and coins). Never other people's data and never staff
 * notes; secrets such as password hashes and payment instruments are not part of it. Each list is cut at
 * `EXPORT_ROWS_PER_KIND` and `truncated` names the lists that were.
 */
async function buildExport(tx: Tx, userId: string, now: Date): Promise<Record<string, unknown>> {
  const uid = sql`${userId}::uuid`;
  const lists: Record<string, Section> = {
    addresses: await section(
      tx,
      sql`select label, contact_name, contact_phone, line1, line2, landmark, pincode, created_at
        from addresses where user_id = ${uid} and deleted_at is null order by created_at, id`,
    ),
    vehicles: await section(
      tx,
      sql`select type, make, model, variant, year, fuel, registration, created_at
        from vehicles where user_id = ${uid} and deleted_at is null order by created_at, id`,
    ),
    consents: await section(
      tx,
      sql`select purpose, granted, notice_version, source, created_at
        from consents where user_id = ${uid} order by created_at, id`,
    ),
    notificationPreferences: await section(
      tx,
      sql`select channel, category, enabled from notification_preferences where user_id = ${uid}
        order by channel, category`,
    ),
    orders: await section(
      tx,
      sql`select o.code, o.status, o.placed_at, o.pincode, o.subtotal_paise, o.discount_paise,
          o.shipping_paise, o.total_paise,
          (select coalesce(json_agg(json_build_object('title', i.title, 'sku', i.sku, 'qty', i.qty,
              'unitPaise', i.unit_paise, 'totalPaise', i.total_paise) order by i.id), '[]'::json)
           from order_items i where i.order_id = o.id) as items
        from orders o where o.user_id = ${uid} order by o.placed_at, o.id`,
    ),
    serviceRequests: await section(
      tx,
      sql`select code, status, pincode, created_at from service_requests where user_id = ${uid}
        order by created_at, id`,
    ),
    tickets: await section(
      tx,
      sql`select code, kind, status, created_at from support_tickets where user_id = ${uid}
        order by created_at, id`,
    ),
    reviews: await section(
      tx,
      sql`select rating, body, status, created_at from reviews where user_id = ${uid}
        order by created_at, id`,
    ),
    coins: await section(
      tx,
      sql`select delta, kind, reason_code, created_at from coin_ledger where user_id = ${uid}
        order by created_at, id`,
    ),
  };
  const [profile] = rowsOf<unknown>(
    await tx.execute(
      sql`select id, name, phone, email, language, status, created_at from users where id = ${uid}`,
    ),
  );
  const out: Record<string, unknown> = {
    formatVersion: EXPORT_FORMAT_VERSION,
    generatedAt: now.toISOString(),
    profile: profile ?? null,
  };
  const truncated: string[] = [];
  for (const [name, sec] of Object.entries(lists)) {
    out[name] = sec.rows;
    if (sec.truncated) truncated.push(name);
  }
  out.truncated = truncated;
  return out;
}

/**
 * Worker: builds the waiting exports (oldest first, a few per run). Each is its own transaction with a row lock
 * (`skip locked`, so two workers never build the same one). Over the size limit, or any error, marks it failed with a
 * code: nothing is stored and the person may ask again right away.
 */
export async function buildDueDataExports(
  db: Tx,
  opts: { limit?: number; maxBytes?: number; now?: Date },
): Promise<{ ready: number; failed: number }> {
  const maxBytes = Math.min(opts.maxBytes ?? EXPORT_MAX_BYTES, EXPORT_MAX_BYTES);
  const now = opts.now ?? new Date();
  const due = rowsOf<{ id: string }>(
    await db.execute(sql`select id from data_export_requests where status = 'requested'
      order by created_at, id limit ${opts.limit ?? 5}`),
  );
  let ready = 0;
  let failed = 0;
  for (const { id } of due) {
    let failure: string | null = null;
    let owner: string | null = null;
    try {
      await db.transaction(async (tx) => {
        const [claimed] = rowsOf<{ user_id: string }>(
          await tx.execute(sql`select user_id from data_export_requests
            where id = ${id}::uuid and status = 'requested' for update skip locked`),
        );
        if (!claimed) return;
        owner = claimed.user_id;
        const payload = await buildExport(tx, claimed.user_id, now);
        const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
        if (bytes > maxBytes) {
          failure = 'too_large';
          return;
        }
        await tx
          .update(dataExportRequests)
          .set({
            status: 'ready',
            payload,
            payloadBytes: bytes,
            readyAt: now,
            expiresAt: new Date(now.getTime() + EXPORT_TTL_HOURS * HOUR_MS),
          })
          .where(eq(dataExportRequests.id, id));
        await tx.insert(auditLog).values({
          actorUserId: null,
          actorRole: 'system',
          action: 'data_export.ready',
          entity: 'data_export',
          entityId: id,
          after: { bytes },
        });
        await recordServerEvent(tx, 'data_export_ready', {
          userId: claimed.user_id,
          props: { exportId: id, bytes },
        });
        ready += 1;
      });
    } catch {
      failure = 'build_error';
    }
    if (failure) {
      const code = failure;
      await db.transaction(async (tx) => {
        const res = await tx
          .update(dataExportRequests)
          .set({ status: 'failed', errorCode: code })
          .where(and(eq(dataExportRequests.id, id), eq(dataExportRequests.status, 'requested')))
          .returning({ id: dataExportRequests.id });
        if (res.length === 0) return;
        await tx.insert(auditLog).values({
          actorUserId: null,
          actorRole: 'system',
          action: 'data_export.failed',
          entity: 'data_export',
          entityId: id,
          after: { errorCode: code },
        });
        await recordServerEvent(tx, 'data_export_failed', {
          userId: owner,
          props: { exportId: id, errorCode: code },
        });
        failed += 1;
      });
    }
  }
  return { ready, failed };
}

/** The owner's download: the JSON, while it is ready and not expired. Every download is audited. */
export async function downloadDataExport(
  db: Tx,
  input: { userId: string; exportId: string; now?: Date },
): Promise<{ payload: unknown; bytes: number; expiresAt: Date }> {
  const now = input.now ?? new Date();
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(dataExportRequests)
      .where(and(eq(dataExportRequests.id, input.exportId), eq(dataExportRequests.userId, input.userId)));
    if (!row) throw new NotFoundError('Download not found');
    if (row.status === 'requested')
      throw new ConflictError('The download is not ready yet', 'EXPORT_NOT_READY');
    if (row.status === 'failed') throw new ConflictError('The download could not be built', 'EXPORT_FAILED');
    if (row.status === 'expired' || !row.expiresAt || row.expiresAt <= now || row.payload === null)
      throw new ConflictError('The download has expired; ask for a new one', 'EXPORT_EXPIRED');
    await tx
      .update(dataExportRequests)
      .set({ downloadedAt: row.downloadedAt ?? now })
      .where(eq(dataExportRequests.id, row.id));
    await tx.insert(auditLog).values({
      actorUserId: input.userId,
      actorRole: 'customer',
      action: 'data_export.downloaded',
      entity: 'data_export',
      entityId: row.id,
    });
    await recordServerEvent(tx, 'data_export_downloaded', {
      userId: input.userId,
      props: { exportId: row.id },
    });
    return { payload: row.payload, bytes: row.payloadBytes ?? 0, expiresAt: row.expiresAt };
  });
}

/** Worker: clears the file of every export past its expiry (the row stays as the record that it happened). */
export async function expireDataExports(db: Tx, opts: { now?: Date }): Promise<number> {
  const now = opts.now ?? new Date();
  const rows = await db
    .update(dataExportRequests)
    .set({ status: 'expired', payload: null, payloadBytes: null })
    .where(and(eq(dataExportRequests.status, 'ready'), lte(dataExportRequests.expiresAt, now)))
    .returning({ id: dataExportRequests.id });
  return rows.length;
}
