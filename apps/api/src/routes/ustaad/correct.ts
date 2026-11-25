import { createRoute, OpenAPIHono } from '@hono/zod-openapi';
import {
  correctionMember,
  correctionWords,
  readUstaadSettingValues,
  type CorrectionMember,
  type CorrectionWords,
} from '@mechdost/db/repo';
import { USTAAD_CORRECTION_MODES, type UstaadCorrectionMode } from '@mechdost/shared/ustaad/codes';
import {
  CORRECTION_LANGS,
  CorrectRequest,
  CorrectResponse,
  correctionSegments,
  countChanges,
  type CorrectResponseView,
} from '@mechdost/shared/ustaad/correction';
import { ApiError } from '../../errors';
import { log } from '../../logger';
import { requireUstaadMember } from '../../middleware/ustaad-member';
import { RateLimitUnavailable } from '../../rate-limit/limiter';
import { TtlCache } from '../../ttl-cache';
import { memoryCorrectionCache } from '../../ustaad/correction/cache';
import { runCorrection } from '../../ustaad/correction/service';
import { createWordListEngine } from '../../ustaad/correction/wordlist';
import type { AppDeps, AppEnv } from '../../types';
import { validationHook } from '../../validation';
import { errorResponses } from '../schemas';

/**
 * `POST /v1/ustaad/correct` (spec 23 § 8 "Correction", § 11). Mounted inside `ustaadRoutes`, so A's `ustaadGate`
 * runs first (access off / staff preview → the generic 404, even for anonymous callers; open + anonymous → 401), then
 * `requireUstaadMember` (non-members and members who left → 404, banned → 403 `USTAAD_BANNED`). As on A's member and
 * media routes the fresh member row is the authority, not the session-cached `ustaad:use` grant, so a member who just
 * joined can use correction at once (the row and the `mechanic` grant are written in one transaction).
 *
 * Modes: `suggest` returns the corrected text with word-level segments for the suggest card; `auto` returns the same
 * shape, the client sends the corrected text and keeps `original` (stored as `body_original`); `off` returns the text
 * unchanged. Text is never logged; logs carry engine, counts and timings only (SR-28).
 */
const DAY_SECONDS = 86_400;
const SETTINGS_TTL_MS = 30_000;

const SETTING_KEYS = [
  'ustaad.correction.default_mode',
  'ustaad.correction.member_can_change',
  'ustaad.correction.langs.hi',
  'ustaad.correction.langs.en',
  'ustaad.correction.langs.hinglish',
  'ustaad.correction.langs.cg',
  'ustaad.correction.timeout_ms',
  'ustaad.correction.llm_daily_calls',
  'ustaad.correction.per_member_per_10min',
  'ustaad.correction.max_length_change_pct',
] as const;
type CorrectionSettings = Awaited<ReturnType<typeof readUstaadSettingValues<(typeof SETTING_KEYS)[number]>>>;

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
  s: CorrectionSettings,
  member: CorrectionMember,
  asked: 'suggest' | 'auto' | undefined,
): UstaadCorrectionMode {
  const def = s['ustaad.correction.default_mode'] as UstaadCorrectionMode;
  if (!s['ustaad.correction.member_can_change']) return def;
  const own = USTAAD_CORRECTION_MODES.find((m) => m === member.correctionMode);
  // The member's own "off" wins over a mode asked for in the request.
  if (own === 'off') return 'off';
  return asked ?? own ?? def;
}

export function ustaadCorrectRoutes(deps: AppDeps) {
  const app = new OpenAPIHono<AppEnv>({ defaultHook: validationHook });
  const settingsCache = new TtlCache<CorrectionSettings>(SETTINGS_TTL_MS, 1);
  const wordsCache = new TtlCache<CorrectionWords>(SETTINGS_TTL_MS, 1);
  const settingsNow = () =>
    settingsCache.getOrLoad('s', () => readUstaadSettingValues(deps.db, SETTING_KEYS));
  const wordsNow = () => wordsCache.getOrLoad('w', () => correctionWords(deps.db));
  const cache = deps.correctionCache ?? memoryCorrectionCache();

  app.use('/ustaad/correct', requireUstaadMember(deps));

  return app.openapi(correct, async (c) => {
    const body = c.req.valid('json');
    const auth = c.get('auth');
    // Mode and consent are not in the guard's member view; read them (a missing row is the guard's 404).
    const member = await correctionMember(deps.db, auth.user.id);
    if (!member) throw new ApiError(404, 'NOT_FOUND', 'Not found');
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
    const langOn = lang === null || (CORRECTION_LANGS.includes(lang) && s[`ustaad.correction.langs.${lang}`]);
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
