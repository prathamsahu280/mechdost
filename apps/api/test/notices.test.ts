/**
 * The bell, push devices and notification choices over HTTP (spec 10, design 2026-11-15): sign-in required, own rows
 * only (a foreign id is 404 or counts as nothing), strict bodies, rate limits, shared schemas; the push adapter sends
 * title/body/link only, revokes tokens Firebase calls gone and retries transient failures; the admin editor for the
 * texts is permission-gated and checks placeholders.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ensureUser,
  grantRole,
  livePushTokens,
  queueNotice,
  registerPushDevice,
  type Tx,
} from '@mechdost/db/repo';
import * as s from '@mechdost/db/schema';
import {
  NoticeClearResultDto,
  NoticeCountDto,
  NoticeDismissResultDto,
  NoticePageDto,
  NoticeRestoreResultDto,
  NoticePreferencesViewDto,
  NoticeReadResultDto,
  NoticeTemplateListDto,
  PushDeviceDto,
} from '@mechdost/shared/notice-api';
import { ChannelError } from '../src/notify/dispatcher';
import { createPushAdapter, type PushMessage, type PushResult } from '../src/notify/push';
import { PUSH_DEVICE_RATE, uaFamily } from '../src/routes/notices';
import { bearer, buildApp, type ErrorJson } from './helpers';

let ctx: Awaited<ReturnType<typeof buildApp>>;

interface Person {
  id: string;
  headers: Record<string, string>;
}

async function person(n: string): Promise<Person> {
  const identity = {
    firebaseUid: `notice-api-${n}`,
    phone: `+9198555555${n}`,
    email: `notice-api-${n}@example.com`,
    emailVerified: true,
  };
  const token = ctx.verifier.add(`token-notice-api-0000${n}`, identity);
  const user = await ensureUser(ctx.db, identity);
  return { id: user.id, headers: { ...bearer(token), 'content-type': 'application/json' } };
}

const call = async (p: Person | null, method: string, path: string, payload?: unknown) => {
  const res = await ctx.app.request(`/v1${path}`, {
    method,
    headers: p?.headers ?? {},
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const text = await res.text();
  return {
    status: res.status,
    body: (text ? JSON.parse(text) : null) as Record<string, unknown> & ErrorJson,
  };
};

const T = (n: number) => `fcm-api-token-${String(n).padStart(4, '0')}-abcdefghijklmnopqrstuvwxyz`;
const tx = () => ctx.db as unknown as Tx;

beforeAll(async () => {
  ctx = await buildApp();
});

describe('the bell', () => {
  it('needs a signed-in person', async () => {
    expect((await call(null, 'GET', '/me/notifications')).status).toBe(401);
    expect((await call(null, 'POST', '/me/notifications/read', { all: true })).status).toBe(401);
    expect((await call(null, 'POST', '/me/push-devices', { token: T(1), locale: 'en' })).status).toBe(401);
  });

  it('lists only your own notifications, newest first, and counts the unread', async () => {
    const a = await person('01');
    const b = await person('02');
    for (let i = 0; i < 3; i += 1)
      await queueNotice(tx(), {
        kind: 'order.placed',
        userId: a.id,
        entityId: `e${String(i)}`,
        version: 1,
        params: { orderCode: `MD-A${String(i)}` },
      });
    await queueNotice(tx(), {
      kind: 'order.placed',
      userId: b.id,
      entityId: 'eb',
      version: 1,
      params: { orderCode: 'MD-B' },
    });
    const page = await call(a, 'GET', '/me/notifications?limit=2');
    expect(page.status).toBe(200);
    const parsed = NoticePageDto.parse(page.body);
    expect(parsed.notices).toHaveLength(2);
    expect(parsed.unread).toBe(3);
    expect(parsed.nextCursor).not.toBeNull();
    expect(JSON.stringify(parsed)).not.toContain('MD-B');
    const next = await call(
      a,
      'GET',
      `/me/notifications?limit=2&cursor=${encodeURIComponent(parsed.nextCursor ?? '')}`,
    );
    expect(NoticePageDto.parse(next.body).notices).toHaveLength(1);
    expect(NoticeCountDto.parse((await call(a, 'GET', '/me/notifications/unread-count')).body).unread).toBe(
      3,
    );
  });

  it('a tampered cursor is a 422; a bad limit is a 400', async () => {
    const a = await person('03');
    expect((await call(a, 'GET', '/me/notifications?cursor=garbage')).status).toBe(422);
    expect((await call(a, 'GET', '/me/notifications?limit=500')).status).toBe(400);
  });

  it('reads your own ids; someone else’s id changes nothing; read-all clears the badge', async () => {
    const a = await person('04');
    const b = await person('05');
    await queueNotice(tx(), {
      kind: 'order.placed',
      userId: a.id,
      entityId: 'r1',
      version: 1,
      params: { orderCode: 'MD-R1' },
    });
    await queueNotice(tx(), {
      kind: 'order.placed',
      userId: a.id,
      entityId: 'r2',
      version: 1,
      params: { orderCode: 'MD-R2' },
    });
    await queueNotice(tx(), {
      kind: 'order.placed',
      userId: b.id,
      entityId: 'r3',
      version: 1,
      params: { orderCode: 'MD-R3' },
    });
    const mine = NoticePageDto.parse((await call(a, 'GET', '/me/notifications')).body).notices;
    const theirs = NoticePageDto.parse((await call(b, 'GET', '/me/notifications')).body).notices;
    const r = await call(a, 'POST', '/me/notifications/read', { ids: [mine[0]?.id, theirs[0]?.id] });
    expect(NoticeReadResultDto.parse(r.body)).toEqual({ updated: 1, unread: 1 });
    expect(NoticePageDto.parse((await call(b, 'GET', '/me/notifications')).body).unread).toBe(1);
    expect(
      NoticeReadResultDto.parse((await call(a, 'POST', '/me/notifications/read', { all: true })).body),
    ).toEqual({ updated: 1, unread: 0 });
  });

  it('refuses unknown fields and empty id lists (no mass assignment)', async () => {
    const a = await person('06');
    expect((await call(a, 'POST', '/me/notifications/read', { all: true, userId: 'x' })).status).toBe(400);
    expect((await call(a, 'POST', '/me/notifications/read', { ids: [] })).status).toBe(400);
  });
});

describe('the inbox: order, remove, clear all read, undo (2026-11-25)', () => {
  const notice = (userId: string, kind: 'order.placed' | 'shop.offer_expiring', n: string) =>
    queueNotice(tx(), {
      kind,
      userId,
      entityId: `inbox-${n}`,
      version: 1,
      params: { orderCode: `MD-${n}`, minutes: 5 },
    });

  it('lists unread urgent first and carries the priority code', async () => {
    const a = await person('11');
    await notice(a.id, 'order.placed', 'a');
    await notice(a.id, 'shop.offer_expiring', 'b');
    const page = NoticePageDto.parse((await call(a, 'GET', '/me/notifications')).body);
    expect(page.notices.map((n) => n.priority)).toEqual(['urgent', 'info']);
  });

  it('removing needs sign-in, takes only your own id (404 otherwise), and Undo brings it back', async () => {
    const a = await person('12');
    const b = await person('13');
    await notice(a.id, 'order.placed', 'c');
    await notice(b.id, 'order.placed', 'd');
    const mine = NoticePageDto.parse((await call(a, 'GET', '/me/notifications')).body).notices[0];
    const theirs = NoticePageDto.parse((await call(b, 'GET', '/me/notifications')).body).notices[0];
    expect((await call(null, 'DELETE', `/me/notifications/${mine?.id}`)).status).toBe(401);
    expect((await call(a, 'DELETE', `/me/notifications/${theirs?.id}`)).status).toBe(404);
    expect((await call(a, 'DELETE', '/me/notifications/not-a-uuid')).status).toBe(400);
    const gone = NoticeDismissResultDto.parse(
      (await call(a, 'DELETE', `/me/notifications/${mine?.id}`)).body,
    );
    expect(gone.unread).toBe(0);
    expect(NoticePageDto.parse((await call(a, 'GET', '/me/notifications')).body).notices).toHaveLength(0);
    expect(NoticePageDto.parse((await call(b, 'GET', '/me/notifications')).body).notices).toHaveLength(1);
    const back = NoticeRestoreResultDto.parse(
      (await call(a, 'POST', '/me/notifications/restore', { undoToken: gone.undoToken })).body,
    );
    expect(back.restored).toBe(1);
    expect(NoticePageDto.parse((await call(a, 'GET', '/me/notifications')).body).notices).toHaveLength(1);
  });

  it('clear all read removes only your read notices; Undo restores them; bad bodies are 400', async () => {
    const a = await person('14');
    await notice(a.id, 'order.placed', 'e');
    await notice(a.id, 'order.placed', 'f');
    await call(a, 'POST', '/me/notifications/read', { all: true });
    await notice(a.id, 'shop.offer_expiring', 'g');
    expect((await call(null, 'POST', '/me/notifications/clear-read')).status).toBe(401);
    const cleared = NoticeClearResultDto.parse((await call(a, 'POST', '/me/notifications/clear-read')).body);
    expect(cleared).toMatchObject({ cleared: 2, unread: 1 });
    expect(NoticePageDto.parse((await call(a, 'GET', '/me/notifications')).body).notices).toHaveLength(1);
    expect((await call(a, 'POST', '/me/notifications/restore', { undoToken: 'yesterday' })).status).toBe(400);
    expect(
      (await call(a, 'POST', '/me/notifications/restore', { undoToken: cleared.undoToken, userId: 'x' }))
        .status,
    ).toBe(400);
    const back = await call(a, 'POST', '/me/notifications/restore', { undoToken: cleared.undoToken });
    expect(NoticeRestoreResultDto.parse(back.body).restored).toBe(2);
    expect(NoticePageDto.parse((await call(a, 'GET', '/me/notifications')).body).notices).toHaveLength(3);
  });

  it('another person’s undo token restores nothing of yours', async () => {
    const a = await person('15');
    const b = await person('16');
    await notice(a.id, 'order.placed', 'h');
    await call(a, 'POST', '/me/notifications/read', { all: true });
    const cleared = NoticeClearResultDto.parse((await call(a, 'POST', '/me/notifications/clear-read')).body);
    const stolen = await call(b, 'POST', '/me/notifications/restore', { undoToken: cleared.undoToken });
    expect(NoticeRestoreResultDto.parse(stolen.body).restored).toBe(0);
    expect(NoticePageDto.parse((await call(a, 'GET', '/me/notifications')).body).notices).toHaveLength(0);
  });
});

describe('push devices and choices', () => {
  it('registers a device and removes it; another person’s id is 404', async () => {
    const a = await person('07');
    const b = await person('08');
    const reg = await call(a, 'POST', '/me/push-devices', { token: T(7), locale: 'hi' });
    expect(reg.status).toBe(201);
    const device = PushDeviceDto.parse(reg.body);
    expect((await call(b, 'DELETE', `/me/push-devices/${device.id}`)).status).toBe(404);
    expect((await livePushTokens(tx(), a.id)).map((d) => d.token)).toEqual([T(7)]);
    expect((await call(a, 'DELETE', `/me/push-devices/${device.id}`)).status).toBe(200);
    expect(await livePushTokens(tx(), a.id)).toEqual([]);
    // The token is never echoed back.
    expect(JSON.stringify(reg.body)).not.toContain(T(7));
  });

  it('refuses a short token, an unknown field and a bad locale', async () => {
    const a = await person('09');
    expect((await call(a, 'POST', '/me/push-devices', { token: 'short', locale: 'en' })).status).toBe(400);
    expect((await call(a, 'POST', '/me/push-devices', { token: T(9), locale: 'fr' })).status).toBe(400);
    expect(
      (await call(a, 'POST', '/me/push-devices', { token: T(9), locale: 'en', userId: 'x' })).status,
    ).toBe(400);
  });

  it('device writes are limited per person', async () => {
    const a = await person('10');
    let last = 0;
    for (let i = 0; i < PUSH_DEVICE_RATE.limit + 1; i += 1)
      last = (await call(a, 'POST', '/me/push-devices', { token: T(1000 + i), locale: 'en' })).status;
    expect(last).toBe(429);
  });

  it('choices: defaults, push off for updates, promotions record the consent and can be withdrawn', async () => {
    const a = await person('11');
    const d = NoticePreferencesViewDto.parse((await call(a, 'GET', '/me/notification-preferences')).body);
    expect(d).toEqual({ pushTransactional: true, promotions: false, promptSnoozeDays: 14 });
    const on = await call(a, 'PATCH', '/me/notification-preferences', {
      promotions: true,
      pushTransactional: false,
    });
    expect(NoticePreferencesViewDto.parse(on.body)).toMatchObject({
      pushTransactional: false,
      promotions: true,
    });
    await call(a, 'PATCH', '/me/notification-preferences', { promotions: false });
    const log = (await ctx.db.select().from(s.consents).orderBy(s.consents.createdAt)).filter(
      (c) => c.userId === a.id,
    );
    expect(log.map((c) => c.granted)).toEqual([true, false]);
    expect((await call(a, 'PATCH', '/me/notification-preferences', {})).status).toBe(400);
    expect((await call(a, 'PATCH', '/me/notification-preferences', { admin: true })).status).toBe(400);
  });
});

describe('browser family from the User-Agent', () => {
  it('names the family and keeps nothing else', () => {
    expect(uaFamily('Mozilla/5.0 Chrome/130.0 Safari/537.36')).toBe('chrome');
    expect(uaFamily('Mozilla/5.0 Chrome/130.0 Safari/537.36 Edg/130.0')).toBe('edge');
    expect(uaFamily('Mozilla/5.0 Firefox/131.0')).toBe('firefox');
    expect(uaFamily('Mozilla/5.0 (iPhone) Version/17 Safari/604.1')).toBe('safari');
    expect(uaFamily(undefined)).toBe('other');
  });
});

describe('the push adapter', () => {
  const row = (userId: string | null) => ({
    id: 'outbox-1',
    channel: 'push' as const,
    recipientUserId: userId,
    recipient: null,
    templateKey: 'order.confirmed',
    locale: 'en' as const,
    payload: { title: 'Order confirmed', body: 'Seller confirmed MD-1.', link: '/orders/MD-1' },
    attempts: 1,
    claimToken: 'claim',
  });
  const adapterWith = (results: PushResult[] | Error, sent: PushMessage[][] = []) =>
    createPushAdapter({
      db: tx(),
      webBaseUrl: 'https://mechdost.test/',
      transport: {
        sendEach(messages) {
          sent.push([...messages]);
          return results instanceof Error ? Promise.reject(results) : Promise.resolve(results);
        },
      },
    });

  it('sends title, body and an absolute link to every live device, nothing else', async () => {
    const a = await person('12');
    await registerPushDevice(tx(), a.id, { token: T(21), locale: 'en', uaFamily: 'chrome' }, 10);
    await registerPushDevice(tx(), a.id, { token: T(22), locale: 'en', uaFamily: 'firefox' }, 10);
    const sent: PushMessage[][] = [];
    const out = await adapterWith(
      [
        { ok: true, messageId: 'm1' },
        { ok: true, messageId: 'm2' },
      ],
      sent,
    ).send(row(a.id));
    expect(out.providerId).toBe('m1');
    expect(sent[0]).toHaveLength(2);
    expect(sent[0]?.[0]).toEqual({
      token: expect.any(String) as string,
      notification: { title: 'Order confirmed', body: 'Seller confirmed MD-1.' },
      link: 'https://mechdost.test/orders/MD-1',
      data: { kind: 'order.confirmed', link: '/orders/MD-1' },
    });
  });

  it('revokes tokens Firebase calls gone, and fails permanently when none is left', async () => {
    const a = await person('13');
    await registerPushDevice(tx(), a.id, { token: T(31), locale: 'en', uaFamily: 'chrome' }, 10);
    await expect(
      adapterWith([{ ok: false, code: 'messaging/registration-token-not-registered' }]).send(row(a.id)),
    ).rejects.toMatchObject({ failure: 'permanent', code: 'token_gone' });
    expect(await livePushTokens(tx(), a.id)).toEqual([]);
    await expect(adapterWith([]).send(row(a.id))).rejects.toMatchObject({
      failure: 'permanent',
      code: 'no_device',
    });
  });

  it('one good device is enough even when another token is gone', async () => {
    const a = await person('14');
    await registerPushDevice(tx(), a.id, { token: T(41), locale: 'en', uaFamily: 'chrome' }, 10);
    await registerPushDevice(tx(), a.id, { token: T(42), locale: 'en', uaFamily: 'chrome' }, 10);
    const out = await adapterWith([
      { ok: false, code: 'messaging/registration-token-not-registered' },
      { ok: true, messageId: 'ok' },
    ]).send(row(a.id));
    expect(out.providerId).toBe('ok');
    expect(await livePushTokens(tx(), a.id)).toHaveLength(1);
  });

  it('retries a busy service and a network failure; refuses a payload with a foreign link', async () => {
    const a = await person('15');
    await registerPushDevice(tx(), a.id, { token: T(51), locale: 'en', uaFamily: 'chrome' }, 10);
    await expect(
      adapterWith([{ ok: false, code: 'messaging/server-unavailable' }]).send(row(a.id)),
    ).rejects.toMatchObject({ failure: 'retry' });
    await expect(adapterWith(new Error('boom')).send(row(a.id))).rejects.toMatchObject({
      failure: 'retry',
      code: 'network',
    });
    const bad = { ...row(a.id), payload: { title: 'x', body: 'y', link: '//evil.example/' } };
    await expect(adapterWith([]).send(bad)).rejects.toBeInstanceOf(ChannelError);
    await expect(adapterWith([]).send(row(null))).rejects.toMatchObject({ code: 'no_recipient' });
  });
});

describe('admin: bell and push text', () => {
  async function staff(role: 'marketing' | 'support_agent', n: string) {
    const p = await person(n);
    await grantRole(ctx.db, { userId: p.id, role, grantedBy: null });
    return p;
  }

  it('only notifications:manage holders reach the editor', async () => {
    const support = await staff('support_agent', '16');
    expect((await call(support, 'GET', '/admin/notifications/notices')).status).toBe(403);
    expect((await call(null, 'GET', '/admin/notifications/notices')).status).toBe(401);
  });

  it('lists the catalogue with both default texts; saves, rejects bad text, resets', async () => {
    const m = await staff('marketing', '17');
    const list = NoticeTemplateListDto.parse((await call(m, 'GET', '/admin/notifications/notices')).body);
    const entry = list.catalogue.find((e) => e.key === 'order.confirmed');
    expect(entry).toMatchObject({ audience: 'customer', placeholders: ['orderCode'] });
    expect(entry?.defaults.hi.title).toMatch(/[ऀ-ॿ]/);
    const save = (over: Record<string, unknown>) =>
      call(m, 'PUT', '/admin/notifications/notices', {
        key: 'order.confirmed',
        channel: 'inapp',
        locale: 'en',
        title: 'Good news',
        body: 'Seller said yes to {orderCode}.',
        enabled: true,
        version: null,
        ...over,
      });
    const ok = await save({});
    expect(ok.status).toBe(200);
    expect((await save({ body: 'Total {amount}' })).status).toBe(422);
    expect((await save({ body: '<b>hi</b>' })).status).toBe(422);
    expect((await save({ key: 'nope.nope' })).status).toBe(422);
    expect((await save({ version: null })).status).toBe(409);
    const version = ok.body.version as number;
    const reset = await call(m, 'POST', '/admin/notifications/notices/reset', {
      key: 'order.confirmed',
      channel: 'inapp',
      locale: 'en',
      version,
    });
    expect(reset.status).toBe(200);
    expect(
      NoticeTemplateListDto.parse((await call(m, 'GET', '/admin/notifications/notices')).body).templates,
    ).toHaveLength(0);
  });

  it('the generic template endpoint refuses bell and push text (one validated editor)', async () => {
    const m = await staff('marketing', '18');
    const res = await call(m, 'PUT', '/admin/notifications/templates', {
      key: 'order.confirmed',
      channel: 'push',
      locale: 'en',
      body: 'x',
      enabled: true,
      version: null,
    });
    expect(res.status).toBe(422);
  });
});
