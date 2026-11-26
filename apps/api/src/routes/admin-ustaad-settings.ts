import { createRoute, OpenAPIHono, z } from '@hono/zod-openapi';
import type { Context, MiddlewareHandler } from 'hono';
import {
  addUstaadReservedName,
  createUstaadBadge,
  createUstaadCoachmark,
  createUstaadLevelRule,
  createUstaadPromotion,
  createUstaadReason,
  createUstaadTag,
  createUstaadTutorialCard,
  createUstaadWord,
  listUstaadBadges,
  listUstaadCoachmarks,
  listUstaadReservedNames,
  listUstaadLevelRules,
  listUstaadPromotions,
  listUstaadReachCities,
  listUstaadReasons,
  listUstaadTags,
  listUstaadTutorialCards,
  listUstaadWords,
  mergeUstaadTag,
  moveUstaadPromotion,
  readUstaadSettings,
  saveUstaadSettings,
  setUstaadReachCity,
  setUstaadReservedNameActive,
  updateUstaadBadge,
  updateUstaadCoachmark,
  updateUstaadLevelRule,
  updateUstaadPromotion,
  updateUstaadReason,
  updateUstaadTag,
  updateUstaadTutorialCard,
  updateUstaadWord,
} from '@mechdost/db/repo';
import { can, type Permission } from '@mechdost/shared/rbac';
import { REPORT_REASONS } from '@mechdost/shared/ustaad/codes';
import {
  BadgeRowDto,
  BadgeUpdateDto,
  BadgeWriteDto,
  CoachmarkRowDto,
  CoachmarkUpdateDto,
  CoachmarkWriteDto,
  LevelRuleRowDto,
  LevelRuleUpdateDto,
  LevelRuleWriteDto,
  PromotionMoveDto,
  PromotionRowDto,
  PromotionUpdateDto,
  PromotionWriteDto,
  ReachCityRowDto,
  ReachCityWriteDto,
  ReasonRowDto,
  ReasonUpdateDto,
  ReasonWriteDto,
  TagMergeDto,
  TagRowDto,
  TagUpdateDto,
  TagWriteDto,
  TutorialCardRowDto,
  TutorialCardUpdateDto,
  TutorialCardWriteDto,
  UstaadSettingsSaveDto,
  WordRowDto,
  WordUpdateDto,
  WordWriteDto,
} from '@mechdost/shared/ustaad/dto/admin';
import { USTAAD_SETTINGS, USTAAD_SETTING_KEYS } from '@mechdost/shared/ustaad/settings';
import type { SessionCache } from '../auth/session-cache';
import { ApiError, Forbidden } from '../errors';
import { authenticate, requireVerified } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { UstaadAccessCache } from '../middleware/ustaad-member';
import { USTAAD_RATE_RULES } from '../rate-limit/ustaad-rules';
import type { AppDeps, AppEnv } from '../types';
import { validationHook } from '../validation';
import { errorResponses } from './schemas';
import { body, conflict, json } from './service-schemas';

/**
 * Admin → Ustaad Network settings and tables (spec 23 § 3, § 8 "Admin", § 15; task G1). Verified staff, two-step
 * session, 300 requests a minute. Reading needs `ustaad:settings` or `ustaad:read` (super admin, community manager,
 * ops); every write needs `ustaad:settings` (super admin) — except promotions, which are `ustaad:promotions`
 * (marketing, super admin) to write and `ustaad:promotions` or `ustaad:read` to read. These routes are never behind
 * the `ustaad.access` switch, so turning the network off cannot lock the admin out.
 *
 * The guard below owns only this router's paths under `/admin/ustaad/` (one pattern, so the limit counts once, L54);
 * other routers under the same prefix (verification, moderation: workstreams B and F) keep their own guards.
 */
const OWN =
  /\/admin\/ustaad\/(settings|levels|badges|tags|words|reasons|reach-cities|promotions|tutorial-cards|coachmarks|reserved-names)(\/|$)/;

const meta = { tags: ['ustaad-admin'], security: [{ bearerAuth: [] }] };
const ReservedNameWriteDto = z
  .object({ name: z.string().trim().min(2).max(60) })
  .strict()
  .openapi('UstaadReservedName');
const ReservedNameUpdateDto = z
  .object({ active: z.boolean(), version: z.number().int().min(1) })
  .strict()
  .openapi('UstaadReservedNameUpdate');
const Anything = z.any();
const responses = { 200: json(Anything, 'OK'), ...conflict, ...errorResponses };
const Id = z.object({ id: z.uuid().openapi({ param: { name: 'id', in: 'path' } }) });
const ReasonCode = z.object({
  code: z.enum(REPORT_REASONS).openapi({ param: { name: 'code', in: 'path' } }),
});

const list = <P extends string>(p: P, what: string) =>
  createRoute({
    ...meta,
    method: 'get',
    path: `/admin/ustaad/${p}` as const,
    summary: `List ${what}`,
    responses,
  });
const create = <P extends string, S extends z.ZodType>(p: P, what: string, schema: S) =>
  createRoute({
    ...meta,
    method: 'post',
    path: `/admin/ustaad/${p}` as const,
    summary: `Create ${what} (audited)`,
    request: { body: body(schema) },
    responses,
  });
const update = <P extends string, S extends z.ZodType>(p: P, what: string, schema: S) =>
  createRoute({
    ...meta,
    method: 'patch',
    path: `/admin/ustaad/${p}/{id}` as const,
    summary: `Edit ${what} (compare-and-set, audited)`,
    request: { params: Id, body: body(schema) },
    responses,
  });
const action = <P extends string, S extends z.ZodType>(
  method: 'post' | 'put',
  path: P,
  summary: string,
  schema: S,
) => createRoute({ ...meta, method, path, summary, request: { params: Id, body: body(schema) }, responses });

const R = {
  settings: list('settings', 'every network setting: value, default, version'),
  /** One key (workstream A's access switch and scripts); the same checks as the batch save. */
  saveOne: createRoute({
    ...meta,
    method: 'put',
    path: '/admin/ustaad/settings/{key}',
    summary: 'Save one setting (compare-and-set; version null to create; reasonCode for video above 180 s)',
    request: {
      params: z.object({
        key: z
          .string()
          .min(1)
          .max(80)
          .openapi({ param: { name: 'key', in: 'path' }, example: 'ustaad.access' }),
      }),
      body: body(
        z
          .object({
            value: z.union([z.number().int(), z.boolean(), z.string().max(40)]),
            version: z.number().int().min(1).nullable(),
            reasonCode: UstaadSettingsSaveDto.shape.reasonCode,
          })
          .strict()
          .openapi('AdminUstaadSettingSave'),
      ),
    },
    responses,
  }),
  saveSettings: createRoute({
    ...meta,
    method: 'patch',
    path: '/admin/ustaad/settings',
    summary: 'Save changed settings together (invariants on the merged set, compare-and-set, audited)',
    request: { body: body(UstaadSettingsSaveDto.openapi('UstaadSettingsSave')) },
    responses,
  }),
  levels: list('levels', 'level rules'),
  levelCreate: create('levels', 'a level rule', LevelRuleWriteDto.openapi('UstaadLevelRule')),
  levelUpdate: update('levels', 'a level rule', LevelRuleUpdateDto.openapi('UstaadLevelRuleUpdate')),
  badges: list('badges', 'badges'),
  badgeCreate: create('badges', 'a badge', BadgeWriteDto.openapi('UstaadBadge')),
  badgeUpdate: update('badges', 'a badge', BadgeUpdateDto.openapi('UstaadBadgeUpdate')),
  tags: list('tags', 'hashtags'),
  tagCreate: create('tags', 'a hashtag', TagWriteDto.openapi('UstaadTag')),
  tagUpdate: update('tags', 'a hashtag', TagUpdateDto.openapi('UstaadTagUpdate')),
  tagMerge: action(
    'post',
    '/admin/ustaad/tags/{id}/merge',
    'Merge a hashtag into another (audited)',
    TagMergeDto.openapi('UstaadTagMerge'),
  ),
  words: list('words', 'word lists'),
  wordCreate: create('words', 'a word', WordWriteDto.openapi('UstaadWord')),
  wordUpdate: update('words', 'a word', WordUpdateDto.openapi('UstaadWordUpdate')),
  reasons: list('reasons', 'report reasons'),
  reasonCreate: create('reasons', 'a report reason', ReasonWriteDto.openapi('UstaadReason')),
  reasonUpdate: createRoute({
    ...meta,
    method: 'patch',
    path: '/admin/ustaad/reasons/{code}',
    summary: 'Edit a report reason (CAS, audited)',
    request: { params: ReasonCode, body: body(ReasonUpdateDto.openapi('UstaadReasonUpdate')) },
    responses,
  }),
  cities: list('reach-cities', 'cities and whether the network is open there'),
  citySet: action(
    'put',
    '/admin/ustaad/reach-cities/{id}',
    'Open or close the network in a city (CAS)',
    ReachCityWriteDto.openapi('UstaadReachCity'),
  ),
  promotions: list('promotions', 'promotions'),
  promotionCreate: create('promotions', 'a promotion (draft)', PromotionWriteDto.openapi('UstaadPromotion')),
  promotionUpdate: update('promotions', 'a promotion', PromotionUpdateDto.openapi('UstaadPromotionUpdate')),
  promotionMove: action(
    'post',
    '/admin/ustaad/promotions/{id}/move',
    'Schedule, unschedule or end a promotion',
    PromotionMoveDto.openapi('UstaadPromotionMove'),
  ),
  cards: list('tutorial-cards', 'tutorial cards'),
  cardCreate: create('tutorial-cards', 'a tutorial card', TutorialCardWriteDto.openapi('UstaadTutorialCard')),
  cardUpdate: update(
    'tutorial-cards',
    'a tutorial card',
    TutorialCardUpdateDto.openapi('UstaadTutorialCardUpdate'),
  ),
  coachmarks: list('coachmarks', 'coach-marks'),
  coachmarkCreate: create('coachmarks', 'a coach-mark', CoachmarkWriteDto.openapi('UstaadCoachmark')),
  coachmarkUpdate: update('coachmarks', 'a coach-mark', CoachmarkUpdateDto.openapi('UstaadCoachmarkUpdate')),
  // Reserved names (SR-4): brand, operator, staff and partner names members may not use (look-alikes included).
  reservedNames: list('reserved-names', 'reserved names'),
  reservedNameCreate: create('reserved-names', 'a reserved name', ReservedNameWriteDto),
  reservedNameUpdate: update('reserved-names', 'a reserved name (on or off)', ReservedNameUpdateDto),
};

/** Any of `permissions`; a staff grant withheld for a missing second step answers STAFF_2FA_REQUIRED (as elsewhere). */
function requireAny(c: Context<AppEnv>, permissions: readonly Permission[]): void {
  const auth = c.get('auth');
  if (permissions.some((p) => can(auth.grants, p))) return;
  if (permissions.some((p) => can(auth.staffWithheld, p)))
    throw Forbidden('STAFF_2FA_REQUIRED', 'Sign in with your password and the code sent to your phone');
  throw Forbidden();
}

const permissionGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const promotions = c.req.path.includes('/admin/ustaad/promotions');
  const write = c.req.method !== 'GET';
  if (promotions) requireAny(c, write ? ['ustaad:promotions'] : ['ustaad:promotions', 'ustaad:read']);
  else requireAny(c, write ? ['ustaad:settings'] : ['ustaad:settings', 'ustaad:read']);
  await next();
};

/** Runs `mws` in order, then `next` (the matched handler). */
function chain(mws: readonly MiddlewareHandler<AppEnv>[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const step = async (i: number): Promise<void> => {
      const mw = mws[i];
      if (!mw) {
        await next();
        return;
      }
      await mw(c, () => step(i + 1));
    };
    await step(0);
  };
}

const staffId = (c: Context<AppEnv>) => c.get('auth').user.id;
const isSuperAdmin = (c: Context<AppEnv>) => c.get('auth').grants.some((g) => g.role === 'super_admin');

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);
const promotionRow = (p: Awaited<ReturnType<typeof listUstaadPromotions>>[number]) =>
  PromotionRowDto.parse({ ...p, startsAt: iso(p.startsAt), endsAt: iso(p.endsAt) });

/** SR-41: the label is never an input (AT-PROMO-1 answers 422, not 400). */
function refuseLabel(b: { label?: unknown }): void {
  if (b.label !== undefined)
    throw new ApiError(422, 'SETTING_INVARIANT', 'The promotion label is fixed', {
      key: 'ustaad.promo.label',
    });
}
const withoutLabel = <T extends { label?: unknown }>(b: T): Omit<T, 'label'> => {
  refuseLabel(b);
  const { label: _label, ...rest } = b;
  return rest;
};

export function adminUstaadSettingsRoutes(deps: AppDeps, cache: SessionCache, access: UstaadAccessCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const guard = chain([
    authenticate(deps, cache),
    rateLimit(deps.rateLimiter, USTAAD_RATE_RULES.staff, (c) => c.get('auth').user.id),
    requireVerified,
    permissionGuard,
  ]);
  const ownPathsOnly: MiddlewareHandler<AppEnv> = async (c, next) => {
    if (OWN.test(c.req.path)) await guard(c, next);
    else await next();
  };
  app.use('/admin/ustaad/*', ownPathsOnly);

  return app
    .openapi(R.settings, async (c) => {
      const view = await readUstaadSettings(deps.db);
      return c.json(
        {
          settings: USTAAD_SETTING_KEYS.map((key) => {
            const spec = USTAAD_SETTINGS[key];
            return {
              key,
              kind: spec.kind,
              value: view.values[key],
              default: spec.default,
              version: view.versions[key] ?? null,
              ...(spec.kind === 'int' ? { min: spec.min, max: spec.max } : {}),
              ...(spec.kind === 'enum' ? { values: [...spec.values] } : {}),
              locked: 'locked' in spec && spec.locked,
            };
          }),
          canEdit: can(c.get('auth').grants, 'ustaad:settings'),
          canRaiseVideo: isSuperAdmin(c),
        },
        200,
      );
    })
    .openapi(R.saveOne, async (c) => {
      const b = c.req.valid('json');
      const key = c.req.valid('param').key;
      const saved = await saveUstaadSettings(deps.db, {
        changes: [{ key, value: b.value, version: b.version }],
        staffUserId: staffId(c),
        actorRole: isSuperAdmin(c) ? 'super_admin' : 'staff',
        ...(b.reasonCode === undefined ? {} : { reasonCode: b.reasonCode }),
      });
      // The member gate caches the access mode for a few seconds; a switch applies at once.
      if (key === 'ustaad.access') access.clear();
      return c.json({ version: saved.versions[key] ?? 0 }, 200);
    })
    .openapi(R.saveSettings, async (c) => {
      const b = c.req.valid('json');
      const saved = await saveUstaadSettings(deps.db, {
        changes: b.changes,
        staffUserId: staffId(c),
        actorRole: isSuperAdmin(c) ? 'super_admin' : 'staff',
        ...(b.reasonCode === undefined ? {} : { reasonCode: b.reasonCode }),
      });
      if (b.changes.some((x) => x.key === 'ustaad.access')) access.clear();
      return c.json(saved, 200);
    })
    .openapi(R.levels, async (c) =>
      c.json({ levels: (await listUstaadLevelRules(deps.db)).map((r) => LevelRuleRowDto.parse(r)) }, 200),
    )
    .openapi(R.levelCreate, async (c) =>
      c.json(
        LevelRuleRowDto.parse(await createUstaadLevelRule(deps.db, staffId(c), c.req.valid('json'))),
        200,
      ),
    )
    .openapi(R.levelUpdate, async (c) =>
      c.json(
        LevelRuleRowDto.parse(
          await updateUstaadLevelRule(deps.db, staffId(c), c.req.valid('param').id, c.req.valid('json')),
        ),
        200,
      ),
    )
    .openapi(R.badges, async (c) =>
      c.json({ badges: (await listUstaadBadges(deps.db)).map((r) => BadgeRowDto.parse(r)) }, 200),
    )
    .openapi(R.badgeCreate, async (c) =>
      c.json(BadgeRowDto.parse(await createUstaadBadge(deps.db, staffId(c), c.req.valid('json'))), 200),
    )
    .openapi(R.badgeUpdate, async (c) =>
      c.json(
        BadgeRowDto.parse(
          await updateUstaadBadge(deps.db, staffId(c), c.req.valid('param').id, c.req.valid('json')),
        ),
        200,
      ),
    )
    .openapi(R.tags, async (c) =>
      c.json({ tags: (await listUstaadTags(deps.db)).map((r) => TagRowDto.parse(r)) }, 200),
    )
    .openapi(R.tagCreate, async (c) =>
      c.json(
        TagRowDto.parse({ ...(await createUstaadTag(deps.db, staffId(c), c.req.valid('json'))), posts: 0 }),
        200,
      ),
    )
    .openapi(R.tagUpdate, async (c) =>
      c.json(
        TagRowDto.parse({
          ...(await updateUstaadTag(deps.db, staffId(c), c.req.valid('param').id, c.req.valid('json'))),
          posts: 0,
        }),
        200,
      ),
    )
    .openapi(R.tagMerge, async (c) => {
      const row = await mergeUstaadTag(deps.db, staffId(c), c.req.valid('param').id, c.req.valid('json'));
      return c.json(TagRowDto.parse({ ...row, posts: 0 }), 200);
    })
    .openapi(R.words, async (c) =>
      c.json({ words: (await listUstaadWords(deps.db)).map((r) => WordRowDto.parse(r)) }, 200),
    )
    .openapi(R.wordCreate, async (c) =>
      c.json(WordRowDto.parse(await createUstaadWord(deps.db, staffId(c), c.req.valid('json'))), 200),
    )
    .openapi(R.wordUpdate, async (c) =>
      c.json(
        WordRowDto.parse(
          await updateUstaadWord(deps.db, staffId(c), c.req.valid('param').id, c.req.valid('json')),
        ),
        200,
      ),
    )
    .openapi(R.reasons, async (c) =>
      c.json({ reasons: (await listUstaadReasons(deps.db)).map((r) => ReasonRowDto.parse(r)) }, 200),
    )
    .openapi(R.reasonCreate, async (c) =>
      c.json(ReasonRowDto.parse(await createUstaadReason(deps.db, staffId(c), c.req.valid('json'))), 200),
    )
    .openapi(R.reasonUpdate, async (c) =>
      c.json(
        ReasonRowDto.parse(
          await updateUstaadReason(deps.db, staffId(c), c.req.valid('param').code, c.req.valid('json')),
        ),
        200,
      ),
    )
    .openapi(R.cities, async (c) =>
      c.json({ cities: (await listUstaadReachCities(deps.db)).map((r) => ReachCityRowDto.parse(r)) }, 200),
    )
    .openapi(R.citySet, async (c) => {
      const row = await setUstaadReachCity(deps.db, staffId(c), c.req.valid('param').id, c.req.valid('json'));
      return c.json({ cityId: row.cityId, enabled: row.enabled, version: row.version }, 200);
    })
    .openapi(R.promotions, async (c) =>
      c.json({ promotions: (await listUstaadPromotions(deps.db)).map(promotionRow) }, 200),
    )
    .openapi(R.promotionCreate, async (c) =>
      c.json(
        promotionRow(await createUstaadPromotion(deps.db, staffId(c), withoutLabel(c.req.valid('json')))),
        200,
      ),
    )
    .openapi(R.promotionUpdate, async (c) =>
      c.json(
        promotionRow(
          await updateUstaadPromotion(
            deps.db,
            staffId(c),
            c.req.valid('param').id,
            withoutLabel(c.req.valid('json')),
          ),
        ),
        200,
      ),
    )
    .openapi(R.promotionMove, async (c) =>
      c.json(
        promotionRow(
          await moveUstaadPromotion(deps.db, staffId(c), c.req.valid('param').id, c.req.valid('json')),
        ),
        200,
      ),
    )
    .openapi(R.cards, async (c) =>
      c.json(
        { cards: (await listUstaadTutorialCards(deps.db)).map((r) => TutorialCardRowDto.parse(r)) },
        200,
      ),
    )
    .openapi(R.cardCreate, async (c) =>
      c.json(
        TutorialCardRowDto.parse(await createUstaadTutorialCard(deps.db, staffId(c), c.req.valid('json'))),
        200,
      ),
    )
    .openapi(R.cardUpdate, async (c) =>
      c.json(
        TutorialCardRowDto.parse(
          await updateUstaadTutorialCard(deps.db, staffId(c), c.req.valid('param').id, c.req.valid('json')),
        ),
        200,
      ),
    )
    .openapi(R.coachmarks, async (c) =>
      c.json({ coachmarks: (await listUstaadCoachmarks(deps.db)).map((r) => CoachmarkRowDto.parse(r)) }, 200),
    )
    .openapi(R.coachmarkCreate, async (c) =>
      c.json(
        CoachmarkRowDto.parse(await createUstaadCoachmark(deps.db, staffId(c), c.req.valid('json'))),
        200,
      ),
    )
    .openapi(R.coachmarkUpdate, async (c) =>
      c.json(
        CoachmarkRowDto.parse(
          await updateUstaadCoachmark(deps.db, staffId(c), c.req.valid('param').id, c.req.valid('json')),
        ),
        200,
      ),
    )
    .openapi(R.reservedNames, async (c) => c.json({ names: await listUstaadReservedNames(deps.db) }, 200))
    .openapi(R.reservedNameCreate, async (c) =>
      c.json(await addUstaadReservedName(deps.db, { userId: staffId(c) }, c.req.valid('json').name), 200),
    )
    .openapi(R.reservedNameUpdate, async (c) => {
      const b = c.req.valid('json');
      return c.json(
        await setUstaadReservedNameActive(deps.db, {
          id: c.req.valid('param').id,
          active: b.active,
          expectedVersion: b.version,
          staffUserId: staffId(c),
        }),
        200,
      );
    });
}
