/**
 * CSV exports over HTTP (design 2026-11-15 item 4, specs 08/12/13/14). Role-leak matrix (401 / 403 / city scope
 * 404), the 180-day rule, signed 10-minute links bound to the staff member who asked (the actor and the grants are
 * checked again on download), masked customer contact columns, CSV injection and BOM, and the audit rows.
 */
import { randomBytes } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { loadKeyring } from '@mechdost/db/crypto';
import { ensureUser, grantRole } from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import { eq } from '@mechdost/db/testing';
import { MAX_EXPORT_DAYS } from '@mechdost/shared/exports';
import { istDateString } from '@mechdost/shared/time';
import { signExportToken } from '../src/exports/token';
import { bearer, buildApp, type ErrorJson } from './helpers';

const k = () => randomBytes(32).toString('base64');
const keyring = loadKeyring({
  DATA_ENCRYPTION_KEYS: `k1:${k()}`,
  DATA_ENCRYPTION_KEY_ID: 'k1',
  DATA_INDEX_KEY: k(),
});

let ctx: Awaited<ReturnType<typeof buildApp>>;
let noKeyring: Awaited<ReturnType<typeof buildApp>>;
let raipur = '';
let bilaspur = '';
const today = istDateString(new Date());
const yesterday = istDateString(new Date(Date.now() - 86_400_000));
const range = { from: yesterday, to: today };

type Who = 'super_admin' | 'ops_manager' | 'support_agent' | 'finance' | 'catalogue_manager' | 'marketing';
async function person(n: string, role: Who | 'city_manager' | null, cityId: string | null = null) {
  const phone = `+9198555555${n}`;
  const token = ctx.verifier.add(`token-export-00000${n}`, {
    firebaseUid: `ex-${n}`,
    phone,
    email: `ex-${n}@example.com`,
    emailVerified: true,
  });
  const user = await ensureUser(ctx.db, {
    firebaseUid: `ex-${n}`,
    phone,
    email: `ex-${n}@example.com`,
    emailVerified: true,
  });
  await ctx.db
    .update(s.users)
    .set({ name: n === '08' ? '=HYPERLINK("http://x")' : `Person ${n}` })
    .where(eq(s.users.id, user.id));
  if (role) await grantRole(ctx.db, { userId: user.id, role, cityId, grantedBy: null });
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

beforeAll(async () => {
  ctx = await buildApp({ keyring });
  noKeyring = await buildApp({ keyring: null });
  const [existing] = await ctx.db.select({ id: s.cities.id }).from(s.cities).limit(1);
  if (existing) raipur = existing.id;
  else {
    const [state] = await ctx.db
      .insert(s.states)
      .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
      .returning();
    raipur = (
      await ctx.db
        .insert(s.cities)
        .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur' })
        .returning()
    )[0]!.id;
  }
  const [rpr] = await ctx.db.select().from(s.cities).where(eq(s.cities.id, raipur));
  bilaspur = (
    await ctx.db
      .insert(s.cities)
      .values({ stateId: rpr!.stateId, code: 'BPL', slug: 'bilaspur', name: 'Bilaspur' })
      .returning()
  )[0]!.id;
});

const post = (headers: Record<string, string>, body: unknown, app = ctx) =>
  app.app.request('/v1/admin/exports', { method: 'POST', headers, body: JSON.stringify(body) });
const download = (path: string, headers?: Record<string, string>) =>
  ctx.app.request(`/v1${path}`, { headers });
const codeOf = async (r: Response) => ((await r.json()) as ErrorJson).error.code;
/** `Response.text()` drops a leading BOM, so the bytes are read and the BOM checked by hand. */
async function bytesOf(res: Response): Promise<{ bom: boolean; text: string }> {
  const b = new Uint8Array(await res.arrayBuffer());
  const bom = b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf;
  return { bom, text: new TextDecoder('utf-8', { ignoreBOM: true }).decode(b.slice(bom ? 3 : 0)) };
}
interface Ticket {
  downloadPath: string;
  expiresAt: string;
  fileName: string;
  rowCount: number;
  masked: boolean;
}
const ticketOf = async (r: Response) => (await r.json()) as Ticket;

describe('role-leak matrix', () => {
  it('is 401 without a token on both routes', async () => {
    expect((await ctx.app.request('/v1/admin/exports', { method: 'POST' })).status).toBe(401);
    expect((await ctx.app.request('/v1/admin/exports/download?t=x')).status).toBe(401);
  });

  it('refuses customers, support agents, catalogue managers and marketing (no exports:run)', async () => {
    for (const [n, role] of [
      ['01', null],
      ['02', 'support_agent'],
      ['03', 'catalogue_manager'],
      ['04', 'marketing'],
    ] as const) {
      const p = await person(n, role);
      for (const dataset of ['orders', 'customers'] as const)
        expect(
          (await post(p.headers, { dataset, ...range })).status,
          `${role ?? 'customer'} ${dataset}`,
        ).toBe(403);
    }
  });

  it('also needs the dataset permission: finance has no customers or service requests', async () => {
    const fin = await person('05', 'finance');
    expect((await post(fin.headers, { dataset: 'customers', ...range })).status).toBe(403);
    expect((await post(fin.headers, { dataset: 'service_requests', ...range })).status).toBe(403);
    for (const dataset of ['orders', 'sub_orders', 'refunds', 'partners'] as const)
      expect((await post(fin.headers, { dataset, ...range })).status, dataset).toBe(200);
  });

  it('a city-scoped manager cannot export customers, nor another city', async () => {
    const mgr = await person('06', 'city_manager', raipur);
    const cust = await post(mgr.headers, { dataset: 'customers', ...range });
    expect(cust.status).toBe(403);
    expect(await codeOf(cust)).toBe('SCOPE_REQUIRED');
    expect((await post(mgr.headers, { dataset: 'orders', cityCode: 'BPL', ...range })).status).toBe(404);
    expect((await post(mgr.headers, { dataset: 'orders', cityCode: 'RPR', ...range })).status).toBe(200);
    expect((await post(mgr.headers, { dataset: 'orders', ...range })).status).toBe(200);
  });

  it('a staff session without the second step gets STAFF_2FA_REQUIRED', async () => {
    const boss = await person('07', 'super_admin');
    ctx.verifier.add('token-export-no2fa00', {
      firebaseUid: 'ex-07',
      phone: '+919855555507',
      email: 'ex-07@example.com',
      emailVerified: true,
      staff2fa: false,
    });
    const res = await post(
      { ...bearer('token-export-no2fa00'), 'content-type': 'application/json' },
      {
        dataset: 'orders',
        ...range,
      },
    );
    expect(res.status).toBe(403);
    expect(await codeOf(res)).toBe('STAFF_2FA_REQUIRED');
    expect(boss.id).toBeTruthy();
  });
});

describe('request validation', () => {
  it('refuses more than 180 days, a reversed range and an impossible date with 422', async () => {
    const ops = await person('09', 'ops_manager');
    const long = await post(ops.headers, { dataset: 'orders', from: '2026-01-01', to: '2026-12-31' });
    expect(long.status).toBe(422);
    expect(await codeOf(long)).toBe('EXPORT_RANGE_TOO_LONG');
    expect(MAX_EXPORT_DAYS).toBe(180);
    const rev = await post(ops.headers, { dataset: 'orders', from: today, to: '2000-01-01' });
    expect(await codeOf(rev)).toBe('EXPORT_RANGE_ORDER');
    const bad = await post(ops.headers, { dataset: 'orders', from: '2026-02-30', to: '2026-03-01' });
    expect(await codeOf(bad)).toBe('EXPORT_RANGE_DATE');
  });

  it('is strict about the body and the dataset, and refuses a city for customers', async () => {
    const boss = await person('10', 'super_admin');
    expect((await post(boss.headers, { dataset: 'orders', ...range, extra: 1 })).status).toBe(400);
    expect((await post(boss.headers, { dataset: 'users', ...range })).status).toBe(400);
    const city = await post(boss.headers, { dataset: 'customers', cityCode: 'RPR', ...range });
    expect(city.status).toBe(422);
    expect(await codeOf(city)).toBe('EXPORT_CITY_NOT_FOR_CUSTOMERS');
  });

  it('answers 503 when the signing key is not configured', async () => {
    const boss = await person('11', 'super_admin');
    const token = noKeyring.verifier.add('token-export-nokeyr00', {
      firebaseUid: 'ex-11',
      phone: '+919855555511',
      email: 'ex-11@example.com',
      emailVerified: true,
    });
    const res = await post(
      { ...bearer(token), 'content-type': 'application/json' },
      { dataset: 'orders', ...range },
      noKeyring,
    );
    expect(boss.id).toBeTruthy();
    expect(res.status).toBe(503);
    expect(await codeOf(res)).toBe('EXPORTS_UNAVAILABLE');
  });
});

describe('download', () => {
  it('streams UTF-8 CSV with a BOM, a header row, CRLF, neutralised formulas and masked contacts', async () => {
    await person('08', null); // name starts with "=" and is created today
    const ops = await person('12', 'ops_manager');
    const res = await post(ops.headers, { dataset: 'customers', ...range });
    expect(res.status).toBe(200);
    const ticket = await ticketOf(res);
    expect(ticket.masked).toBe(true);
    expect(ticket.rowCount).toBeGreaterThan(0);
    expect(ticket.fileName).toMatch(/^mechdost-customers-\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(new Date(ticket.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(600_000);
    const dl = await download(ticket.downloadPath, ops.headers);
    expect(dl.status).toBe(200);
    expect(dl.headers.get('content-type')).toContain('text/csv');
    expect(dl.headers.get('content-type')).toContain('utf-8');
    expect(dl.headers.get('content-disposition')).toContain(`filename="${ticket.fileName}"`);
    expect(dl.headers.get('cache-control')).toContain('no-store');
    const { bom, text } = await bytesOf(dl);
    expect(bom).toBe(true);
    expect(text.startsWith('user_id,name,phone,email,')).toBe(true);
    const lines = text.split('\r\n').filter(Boolean);
    expect(lines.length - 1).toBe(ticket.rowCount);
    expect(text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(text).not.toContain('+9198555555');
    expect(text).toContain('••••••');
  });

  it('shows contact details unmasked only to a role with customers:read_pii, and audits both steps', async () => {
    const boss = await person('13', 'super_admin');
    const ticket = await ticketOf(await post(boss.headers, { dataset: 'customers', ...range }));
    expect(ticket.masked).toBe(false);
    const { text } = await bytesOf(await download(ticket.downloadPath, boss.headers));
    expect(text).toContain('+9198555555');
    const audit = await ctx.db.select().from(s.auditLog).where(eq(s.auditLog.actorUserId, boss.id));
    const requested = audit.find((a) => a.action === 'export.requested');
    const downloaded = audit.find((a) => a.action === 'export.downloaded');
    expect(requested?.after).toMatchObject({
      dataset: 'customers',
      from: yesterday,
      to: today,
      rowCount: ticket.rowCount,
      masked: false,
    });
    expect(downloaded?.after).toMatchObject({ dataset: 'customers', rowCount: ticket.rowCount });
  });

  it('is bound to the staff member who asked and re-checks their rights', async () => {
    const ops = await person('14', 'ops_manager');
    const other = await person('15', 'ops_manager');
    const ticket = await ticketOf(await post(ops.headers, { dataset: 'orders', ...range }));
    const stolen = await download(ticket.downloadPath, other.headers);
    expect(stolen.status).toBe(403);
    expect(await codeOf(stolen)).toBe('EXPORT_LINK_INVALID');
  });

  it('re-checks the dataset permission on download: a link is a note, never a grant', async () => {
    const fin = await person('19', 'finance');
    const forged = signExportToken(keyring, {
      u: fin.id,
      dataset: 'customers',
      from: yesterday,
      to: today,
      city: null,
    });
    expect((await download(`/admin/exports/download?t=${forged}`, fin.headers)).status).toBe(403);
  });

  it('refuses a tampered, expired or missing link', async () => {
    const ops = await person('16', 'ops_manager');
    const ticket = await ticketOf(await post(ops.headers, { dataset: 'orders', ...range }));
    const [path, query] = ticket.downloadPath.split('?t=');
    const tampered = `${path ?? ''}?t=${(query ?? '').slice(0, -2)}AA`;
    const t1 = await download(tampered, ops.headers);
    expect(t1.status).toBe(403);
    expect(await codeOf(t1)).toBe('EXPORT_LINK_INVALID');
    const old = signExportToken(
      keyring,
      { u: ops.id, dataset: 'orders', from: yesterday, to: today, city: null },
      Date.now() - 601_000,
    );
    const t2 = await download(`/admin/exports/download?t=${old}`, ops.headers);
    expect(t2.status).toBe(403);
    expect(await codeOf(t2)).toBe('EXPORT_LINK_EXPIRED');
    expect((await download('/admin/exports/download', ops.headers)).status).toBe(400);
  });

  it('keeps a city manager inside their city on download', async () => {
    const mgr = await person('17', 'city_manager', raipur);
    const ticket = await ticketOf(await post(mgr.headers, { dataset: 'orders', ...range }));
    expect((await download(ticket.downloadPath, mgr.headers)).status).toBe(200);
    // A token for another city (minted for this user, e.g. from an older grant) is refused on the re-check.
    const foreign = signExportToken(keyring, {
      u: mgr.id,
      dataset: 'orders',
      from: yesterday,
      to: today,
      city: 'BPL',
    });
    expect((await download(`/admin/exports/download?t=${foreign}`, mgr.headers)).status).toBe(404);
    expect(bilaspur).toBeTruthy();
  });

  it('exports the other datasets with their headers', async () => {
    const boss = await person('18', 'super_admin');
    for (const [dataset, first] of [
      ['orders', 'code,placed_at_ist'],
      ['sub_orders', 'code,order_code'],
      ['refunds', 'refund_id,order_code'],
      ['service_requests', 'code,created_at_ist'],
      ['partners', 'kind,id'],
    ] as const) {
      const ticket = await ticketOf(await post(boss.headers, { dataset, ...range }));
      const { bom, text } = await bytesOf(await download(ticket.downloadPath, boss.headers));
      expect(bom, dataset).toBe(true);
      expect(text.startsWith(first), dataset).toBe(true);
    }
  });
});

describe('options', () => {
  const options = (headers?: Record<string, string>) =>
    ctx.app.request('/v1/admin/exports/options', headers ? { headers } : {});
  interface Options {
    datasets: string[];
    cities: { code: string; name: string }[];
    contactsMasked: boolean;
  }

  it('is 401 without a token and 403 without exports:run', async () => {
    expect((await options()).status).toBe(401);
    const support = await person('20', 'support_agent');
    expect((await options(support.headers)).status).toBe(403);
  });

  it('lists only the datasets and cities the viewer may export', async () => {
    const boss = await person('21', 'super_admin');
    const all = (await (await options(boss.headers)).json()) as Options;
    expect(all.datasets).toEqual([
      'orders',
      'sub_orders',
      'refunds',
      'service_requests',
      'partners',
      'customers',
    ]);
    expect(all.contactsMasked).toBe(false);
    expect(all.cities.map((c) => c.code)).toEqual(expect.arrayContaining(['RPR', 'BPL']));

    const fin = await person('22', 'finance');
    const finance = (await (await options(fin.headers)).json()) as Options;
    expect(finance.datasets).toEqual(['orders', 'sub_orders', 'refunds', 'partners']);

    const ops = await person('23', 'ops_manager');
    expect(((await (await options(ops.headers)).json()) as Options).contactsMasked).toBe(true);

    const mgr = await person('24', 'city_manager', raipur);
    const city = (await (await options(mgr.headers)).json()) as Options;
    expect(city.datasets).not.toContain('customers');
    expect(city.cities.map((c) => c.code)).toEqual(['RPR']);
  });
});
