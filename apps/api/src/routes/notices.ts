import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import {
  getNoticePreferences,
  globalIntSetting,
  listNotices,
  markNoticesRead,
  registerPushDevice,
  revokePushDevice,
  setNoticePreferences,
  unreadNoticeCount,
} from '@mechdost/db/repo';
import {
  MARKETING_NOTICE_VERSION,
  NOTICE_PAGE_MAX,
  NoticeCountDto,
  NoticePageDto,
  NoticePreferencesPatchDto,
  NoticePreferencesViewDto,
  NoticeReadDto,
  NoticeReadResultDto,
  PUSH_DEVICES_MAX,
  PushDeviceCreateDto,
  PushDeviceDto,
} from '@mechdost/shared/notice-api';
import type { SessionCache } from '../auth/session-cache';
import { authenticate } from '../middleware/auth';
import { rateLimit, RATE_RULES } from '../middleware/rate-limit';
import type { RateRule } from '../rate-limit/limiter';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses, ErrorSchema } from './schemas';

/**
 * The signed-in person's bell, push devices and notification choices (spec 10, design 2026-11-15). Every route is the
 * caller's own data: the repository takes the user id from the session, never from the URL, so another person's id is
 * 404 (or simply not counted). Writes are limited per person (spec 13). Customers, shops, workshops and staff all use
 * the same routes; staff get theirs by permission and city when the notice is written, not here.
 */
export const NOTICE_READ_RATE: RateRule = { name: 'notice_read', limit: 600, windowSeconds: 3600 };
export const PUSH_DEVICE_RATE: RateRule = { name: 'push_device', limit: 30, windowSeconds: 3600 };

const json = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
});
const body = <T extends z.ZodType>(schema: T) => ({
  body: { required: true, content: { 'application/json': { schema } } },
});

const tags = ['notifications'];
const security = [{ bearerAuth: [] }];

const listRoute = createRoute({
  method: 'get',
  path: '/me/notifications',
  tags,
  summary: 'Your notifications, newest first (cursor), with the unread count',
  security,
  request: {
    query: z.object({
      cursor: z.string().max(300).optional(),
      limit: z.coerce.number().int().min(1).max(NOTICE_PAGE_MAX).optional(),
    }),
  },
  responses: {
    200: json(NoticePageDto, 'Notifications'),
    422: json(ErrorSchema, 'Cursor not valid'),
    ...errorResponses,
  },
});
const countRoute = createRoute({
  method: 'get',
  path: '/me/notifications/unread-count',
  tags,
  summary: 'How many notifications you have not read (stops at 100)',
  security,
  responses: { 200: json(NoticeCountDto, 'Count'), ...errorResponses },
});
const readRoute = createRoute({
  method: 'post',
  path: '/me/notifications/read',
  tags,
  summary: 'Mark some of your notifications (or all) as read',
  security,
  request: body(NoticeReadDto),
  responses: { 200: json(NoticeReadResultDto, 'Marked'), ...errorResponses },
});
const registerRoute = createRoute({
  method: 'post',
  path: '/me/push-devices',
  tags,
  summary: 'Register or refresh this browser for push (a token that is already known is moved to you)',
  security,
  request: body(PushDeviceCreateDto),
  responses: { 201: json(PushDeviceDto, 'Registered'), ...errorResponses },
});
const removeRoute = createRoute({
  method: 'delete',
  path: '/me/push-devices/{id}',
  tags,
  summary: 'Stop push on one of your devices',
  security,
  request: { params: z.object({ id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }) }) },
  responses: {
    200: json(z.object({ removed: z.literal(true) }), 'Removed'),
    404: json(ErrorSchema, 'Not found (or not yours)'),
    ...errorResponses,
  },
});
const getPrefsRoute = createRoute({
  method: 'get',
  path: '/me/notification-preferences',
  tags,
  summary: 'Your notification choices',
  security,
  responses: { 200: json(NoticePreferencesViewDto, 'Choices'), ...errorResponses },
});
const patchPrefsRoute = createRoute({
  method: 'patch',
  path: '/me/notification-preferences',
  tags,
  summary: 'Change your notification choices (promotions record or withdraw your marketing consent)',
  security,
  request: body(NoticePreferencesPatchDto),
  responses: { 200: json(NoticePreferencesViewDto, 'Saved'), ...errorResponses },
});

/** Browser family from the User-Agent, so a device list can say "Chrome" without keeping the full string. */
export function uaFamily(header: string | undefined): 'chrome' | 'firefox' | 'safari' | 'edge' | 'other' {
  const ua = header ?? '';
  if (/Edg(e|A|iOS)?\//.test(ua)) return 'edge';
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox';
  if (/Chrome\/|CriOS\//.test(ua)) return 'chrome';
  if (/Safari\//.test(ua)) return 'safari';
  return 'other';
}

export function noticeRoutes(deps: AppDeps, cache: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const user = (c: { get: (k: 'auth') => { user: { id: string } } }) => c.get('auth').user.id;
  for (const path of [
    '/me/notifications',
    '/me/notifications/*',
    '/me/push-devices',
    '/me/push-devices/*',
    '/me/notification-preferences',
  ]) {
    app.use(path, authenticate(deps, cache));
    app.use(
      path,
      rateLimit(deps.rateLimiter, RATE_RULES.apiPerUser, (c) => c.get('auth').user.id),
    );
  }
  app.on(
    ['POST'],
    '/me/notifications/read',
    rateLimit(deps.rateLimiter, NOTICE_READ_RATE, (c) => c.get('auth').user.id),
  );
  for (const path of ['/me/push-devices', '/me/push-devices/*', '/me/notification-preferences'])
    app.on(
      ['POST', 'PATCH', 'DELETE'],
      path,
      rateLimit(deps.rateLimiter, PUSH_DEVICE_RATE, (c) => c.get('auth').user.id),
    );

  const prefsView = async (userId: string) => ({
    ...(await getNoticePreferences(deps.db, userId)),
    promptSnoozeDays: await globalIntSetting(deps.db, 'notifications.push_prompt_snooze_days'),
  });

  return app
    .openapi(listRoute, async (c) => {
      const q = c.req.valid('query');
      return c.json(await listNotices(deps.db, user(c), { cursor: q.cursor, limit: q.limit }), 200);
    })
    .openapi(countRoute, async (c) => c.json({ unread: await unreadNoticeCount(deps.db, user(c)) }, 200))
    .openapi(readRoute, async (c) =>
      c.json(await markNoticesRead(deps.db, user(c), c.req.valid('json')), 200),
    )
    .openapi(registerRoute, async (c) => {
      const input = c.req.valid('json');
      const device = await registerPushDevice(
        deps.db,
        user(c),
        { token: input.token, locale: input.locale, uaFamily: uaFamily(c.req.header('user-agent')) },
        PUSH_DEVICES_MAX,
      );
      return c.json({ id: device.id, platform: input.platform, registered: true as const }, 201);
    })
    .openapi(removeRoute, async (c) => {
      await revokePushDevice(deps.db, user(c), c.req.valid('param').id);
      return c.json({ removed: true as const }, 200);
    })
    .openapi(getPrefsRoute, async (c) => c.json(await prefsView(user(c)), 200))
    .openapi(patchPrefsRoute, async (c) => {
      await setNoticePreferences(deps.db, user(c), c.req.valid('json'), MARKETING_NOTICE_VERSION);
      return c.json(await prefsView(user(c)), 200);
    });
}
