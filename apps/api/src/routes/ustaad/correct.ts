import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createMiddleware } from 'hono/factory';
import {
  correctionMember,
  correctionWords,
  ustaadSettingValues,
  type CorrectionMember,
  type CorrectionWords,
} from '@mechdost/db/repo';
import { isStaffGrant } from '@mechdost/shared/auth';
import { can } from '@mechdost/shared/rbac';
import { ustaadAccessDecision } from '@mechdost/shared/ustaad/access';
import type { UstaadAccessMode, UstaadCorrectionMode } from '@mechdost/shared/ustaad/codes';
import {
  CorrectRequest,
  CorrectResponse,
  correctionSegments,
  countChanges,
  type CorrectResponseView,
} from '@mechdost/shared/ustaad/correction';
import { USTAAD_CORRECTION_MODES } from '@mechdost/shared/ustaad/codes';
import type { UstaadSettingValues } from '@mechdost/shared/ustaad/settings';
import type { SessionCache } from '../../auth/session-cache';
import { ApiError } from '../../errors';
import { log } from '../../logger';
import { authenticate } from '../../middleware/auth';
import { RateLimitUnavailable } from '../../rate-limit/limiter';
import { TtlCache } from '../../ttl-cache';
import { memoryCorrectionCache } from '../../ustaad/correction/cache';
import { runCorrection } from '../../ustaad/correction/service';
import { createWordListEngine } from '../../ustaad/correction/wordlist';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';

/**
 * `POST /v1/ustaad/correct` (spec 23 § 8 "Correction", § 11). Members only. The network gate runs first: with
 * `ustaad.access` = off, or staff_preview and the caller is not staff in a staff session, the answer is the generic
 * 404 a missing path gets (anonymous callers included, so nobody learns the network exists); non-members get the same
 * 404. Workstream A3 owns the shared gate and member guard; this route uses the same rules through the shared
 * `ustaadAccessDecision` and swaps to A3's middleware at merge.
 *
 * Modes: `suggest` returns the corrected text with word-level segments for the suggest card; `auto` returns the same
 * shape, the client sends the corrected text and keeps `original` (stored as `body_original`); `off` returns the text
 * unchanged. Text is never logged; logs carry engine, counts and timings only (SR-28).
 */
const DAY_SECONDS = 86_400;
const SETTINGS_TTL_MS = 30_000;
const NOT_FOUND = () => new ApiError(404, 'NOT_FOUND', 'Not found');

const correct = createRoute({
  method: 'post',
  path: '/ustaad/correct',
  tags: ['ustaad'],
  summary: 'Smart correction of typed text (suggest / auto / off from the admin setting)',
  request: { body: { required: true, content: { 'application/json': { schema: CorrectRequest } } } },
  responses: {
    200: { description: 'Correction', content: { 'application/json': { schema: CorrectResponse } } },
    ...errorResponses,
  },
});

function effectiveMode(
  s: UstaadSettingValues,
  member: CorrectionMember,
  asked: 'suggest' | 'auto' | undefined,
) {
  const def = s['ustaad.correction.default_mode'] as UstaadCorrectionMode;
  if (!s['ustaad.correction.member_can_change']) return def;
  const own = USTAAD_CORRECTION_MODES.find((m) => m === member.correctionMode);
  // The member's own "off" wins over a mode asked for in the request.
  if (own === 'off') return 'off';
  return asked ?? own ?? def;
}

export function ustaadCorrectRoutes(deps: AppDeps, sessions: SessionCache) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const settingsCache = new TtlCache<UstaadSettingValues>(SETTINGS_TTL_MS, 1);
  const wordsCache = new TtlCache<CorrectionWords>(SETTINGS_TTL_MS, 1);
  const settingsNow = () => settingsCache.getOrLoad('s', () => ustaadSettingValues(deps.db));
  const wordsNow = () => wordsCache.getOrLoad('w', () => correctionWords(deps.db));
  const cache = deps.correctionCache ?? memoryCorrectionCache();

  /** Before sign-in: off → 404; staff preview without a bearer → 404 (not 401). */
  const gateBefore = createMiddleware<AppEnv>(async (c, next) => {
    const mode = (await settingsNow())['ustaad.access'] as UstaadAccessMode;
    const hasBearer = /^Bearer\s+\S+/i.test(c.req.header('authorization') ?? '');
    if (mode === 'off' || (mode === 'staff_preview' && !hasBearer)) throw NOT_FOUND();
    await next();
  });
  /** After sign-in: the access decision (staff preview needs a staff grant in a staff session). */
  const gateAfter = createMiddleware<AppEnv>(async (c, next) => {
    const s = await settingsNow();
    const decision = ustaadAccessDecision(s['ustaad.access'] as UstaadAccessMode, {
      signedIn: true,
      staff: c.get('auth').grants.some(isStaffGrant),
    });
    if (decision !== 'allow' || !s['ustaad.general.enabled']) throw NOT_FOUND();
    await next();
  });
  /** Members only: non-members, banned and left members, and callers without `ustaad:use` get the same 404. */
  const memberOf = async (c: Context<AppEnv>): Promise<CorrectionMember> => {
    const auth = c.get('auth');
    const member = await correctionMember(deps.db, auth.user.id);
    if (!member || (member.status !== 'active' && member.status !== 'restricted')) throw NOT_FOUND();
    if (!can(auth.grants, 'ustaad:use', {})) throw NOT_FOUND();
    return member;
  };

  app.use('/ustaad/correct', gateBefore, authenticate(deps, sessions), gateAfter);

  return app.openapi(correct, async (c) => {
    const body = c.req.valid('json');
    const member = await memberOf(c);
    const s = await settingsNow();

    const limit = s['ustaad.correction.per_member_per_10min'] as number;
    const hit = await deps.rateLimiter.hit(
      { name: 'ustaad_correct_member', limit, windowSeconds: 600 },
      member.memberId,
    );
    if (!hit.allowed) {
      c.header('Retry-After', String(Math.max(1, Math.ceil((hit.resetAt - Date.now()) / 1000))));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests — please wait a moment and try again');
    }

    const text = body.text;
    const lang = body.lang ?? null;
    const mode = effectiveMode(s, member, body.mode);
    const langOn = lang === null || s[`ustaad.correction.langs.${lang}`] === true;
    const unchanged = (m: UstaadCorrectionMode): CorrectResponseView => ({
      mode: m,
      engine: null,
      text,
      original: text,
      changed: false,
      changes: 0,
      segments: [{ kind: 'same', text }],
    });
    if (mode === 'off' || !langOn) return c.json(unchanged(mode), 200);

    const words = await wordsNow();
    const dailyCap = s['ustaad.correction.llm_daily_calls'] as number;
    const run = await runCorrection({
      text,
      langHint: lang,
      protectedWords: words.protected,
      protectedVersion: words.version,
      llm: deps.smartCorrection ?? null,
      llmAllowed: member.llmConsent,
      wordList: createWordListEngine({
        rows: words.corrections,
        maxLengthChangePct: s['ustaad.correction.max_length_change_pct'] as number,
      }),
      cache,
      reserveLlmCall: async () => {
        if (dailyCap <= 0) return false;
        try {
          const day = await deps.rateLimiter.hit(
            {
              name: 'ustaad_correction_llm_day',
              limit: dailyCap,
              windowSeconds: DAY_SECONDS,
              failClosed: true,
            },
            'site',
          );
          return day.allowed;
        } catch (err) {
          if (err instanceof RateLimitUnavailable) return false;
          throw err;
        }
      },
      timeoutMs: s['ustaad.correction.timeout_ms'] as number,
      maxLengthChangePct: s['ustaad.correction.max_length_change_pct'] as number,
    });
    const segments = correctionSegments(text, run.text);
    const changes = countChanges(segments);
    log('info', 'ustaad_correction', {
      requestId: c.get('requestId'),
      engine: run.engine,
      mode,
      cached: run.cached,
      llmSkipped: run.llmSkipped,
      changes,
      chars: text.length,
      ms: Math.round(run.ms),
    });
    return c.json(
      {
        mode,
        engine: run.engine,
        text: run.text,
        original: text,
        changed: run.text !== text,
        changes,
        segments,
      } satisfies CorrectResponseView,
      200,
    );
  });
}
