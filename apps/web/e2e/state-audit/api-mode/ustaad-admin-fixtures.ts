/**
 * Typed fixtures of the Admin → Ustaad Network audit row (spec 23 § 15, task G1). Every body carries its shared schema,
 * so a fixture that drifts from the API contract fails the case. `ustaad=defaults|readonly|error` drives the settings
 * call; `lists=few|empty` every list of the sections.
 */
import {
  BadgeListDto,
  CoachmarkListDto,
  LevelRuleListDto,
  PromotionListDto,
  ReachCityListDto,
  ReasonListDto,
  TagListDto,
  TutorialCardListDto,
  UstaadSettingsListDto,
  WordListDto,
  type BadgeRow,
  type CoachmarkRow,
  type LevelRuleRow,
  type PromotionRow,
  type ReachCityRow,
  type ReasonRow,
  type TagRow,
  type TutorialCardRow,
  type WordRow,
} from '@mechdost/shared/ustaad/dto/admin';
import {
  USTAAD_SETTINGS,
  USTAAD_SETTING_KEYS,
  type UstaadSettingSpec,
} from '@mechdost/shared/ustaad/settings';
import type { AuditCase } from '../cases.ts';
import { ustaadConsoleMocks } from './ustaad-console-fixtures.ts';
import type { Mock, Reply } from './mock-api.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const long = (c: AuditCase) => c.state.stress === 'long-text';
const few = (c: AuditCase) => (c.state.lists ?? 'few') !== 'empty';
const rows = <T>(c: AuditCase, items: T[]): T[] => (few(c) ? items : []);
const rowsAlways = <T>(items: T[]): T[] => items;

const get = <S extends { parse(value: unknown): unknown }>(
  path: RegExp,
  schema: S,
  body: () => NoInfer<Dto<S>>,
): Mock => ({
  method: 'GET',
  path,
  schema,
  reply: (): Reply => ({ body: body() }),
});

export function ustaadAdminMocks(c: AuditCase): Mock[] {
  const mode = c.state.ustaad ?? 'defaults';
  const name = long(c) ? 'Bahut lambe naam wala hashtag jo kabhi khatam nahi hota' : 'Battery';
  const nameHi = long(c) ? 'बहुत लंबे नाम वाला हैशटैग जो कभी खत्म नहीं होता' : 'बैटरी';
  return [
    {
      method: 'GET',
      path: /^\/admin\/ustaad\/settings$/,
      schema: UstaadSettingsListDto,
      reply: (): Reply => {
        if (mode === 'error') return { status: 500, code: 'INTERNAL' };
        return {
          body: {
            settings: USTAAD_SETTING_KEYS.map((key) => {
              const spec: UstaadSettingSpec = USTAAD_SETTINGS[key];
              return {
                key,
                kind: spec.kind,
                value: key === 'ustaad.posts.per_day' ? 12 : spec.default,
                default: spec.default,
                version: key === 'ustaad.posts.per_day' ? 2 : null,
                ...(spec.kind === 'int' ? { min: spec.min, max: spec.max } : {}),
                ...(spec.kind === 'enum' ? { values: [...spec.values] } : {}),
                locked: spec.kind === 'boolean' && spec.locked === true,
              };
            }),
            canEdit: mode !== 'readonly',
            canRaiseVideo: mode !== 'readonly',
          } satisfies Dto<typeof UstaadSettingsListDto>,
        };
      },
    },
    get(/^\/admin\/ustaad\/words$/, WordListDto, () => ({
      words: rows<WordRow>(c, [
        {
          id: uuid(1),
          list: 'protected',
          phrase: 'Splendor',
          replacement: null,
          lang: 'any',
          active: true,
          version: 1,
        },
        {
          id: uuid(2),
          list: 'scam_phrase',
          phrase: 'registration fee',
          replacement: null,
          lang: 'en',
          active: true,
          version: 1,
        },
        {
          id: uuid(3),
          list: 'correction',
          phrase: 'battri',
          replacement: 'battery',
          lang: 'hinglish',
          active: true,
          version: 1,
        },
      ]),
    })),
    get(/^\/admin\/ustaad\/levels$/, LevelRuleListDto, () => ({
      levels: rows<LevelRuleRow>(c, [
        {
          id: uuid(10),
          level: 'bada',
          ruleGroup: 'A',
          minFollowers: 50,
          minBestAnswers: 10,
          minHelpfulPct: 70,
          minVerifiedYears: 2,
          minVideos: 0,
          minRecommendations: 0,
          needsStaffReview: true,
          perkEn: '',
          perkHi: '',
          coinMultiplierBp: 12_000,
          nameEn: 'Bada Ustaad',
          nameHi: 'बड़ा उस्ताद',
          position: 4,
          version: 1,
        },
      ]),
    })),
    get(/^\/admin\/ustaad\/badges$/, BadgeListDto, () => ({
      badges: rows<BadgeRow>(c, [
        {
          id: uuid(20),
          code: 'battery_king',
          nameEn: 'Battery king',
          nameHi: 'बैटरी किंग',
          ruleEn: '10 best answers with #battery',
          ruleHi: '#battery पर 10 बेस्ट जवाब',
          icon: 'battery',
          kind: 'speciality',
          rule: { schema_version: 1, kind: 'best_answers_with_tag', tag: 'battery', count: 10 },
          active: true,
          version: 1,
        },
      ]),
    })),
    get(/^\/admin\/ustaad\/tags$/, TagListDto, () => ({
      tags: rows<TagRow>(c, [
        {
          id: uuid(30),
          slug: 'battery',
          nameEn: name,
          nameHi,
          group: 'part',
          aliases: ['battri'],
          active: true,
          mergedIntoId: null,
          posts: 1200,
          version: 1,
        },
      ]),
    })),
    get(/^\/admin\/ustaad\/reasons$/, ReasonListDto, () => ({
      reasons: rowsAlways<ReasonRow>([
        {
          code: 'spam',
          labelEn: 'Spam',
          labelHi: 'फ़ालतू प्रचार',
          active: true,
          defaultClock: 'standard_24h',
          version: 1,
        },
        {
          code: 'other',
          labelEn: 'Something else',
          labelHi: 'कुछ और',
          active: true,
          defaultClock: 'standard_24h',
          version: 1,
        },
      ]),
    })),
    get(/^\/admin\/ustaad\/reach-cities$/, ReachCityListDto, () => ({
      cities: rowsAlways<ReachCityRow>([
        { cityId: uuid(40), code: 'RPR', name: 'Raipur', nameHi: 'रायपुर', enabled: true, version: 1 },
        {
          cityId: uuid(41),
          code: 'BLS',
          name: 'Bilaspur',
          nameHi: 'बिलासपुर',
          enabled: false,
          version: null,
        },
      ]),
    })),
    get(/^\/admin\/ustaad\/promotions$/, PromotionListDto, () => ({
      promotions: rows<PromotionRow>(c, [
        {
          id: uuid(50),
          slot: 'feed',
          titleEn: 'Exide batteries',
          titleHi: 'एक्साइड बैटरी',
          bodyEn: '',
          bodyHi: '',
          target: 'url_internal',
          targetId: '/shop/exide',
          cityIds: [],
          segmentCodes: [],
          startsAt: '2026-12-01T00:00:00.000Z',
          endsAt: '2026-12-08T00:00:00.000Z',
          status: 'draft',
          version: 1,
        },
      ]),
    })),
    get(/^\/admin\/ustaad\/tutorial-cards$/, TutorialCardListDto, () => ({
      cards: rows<TutorialCardRow>(c, [
        {
          id: uuid(60),
          code: 'welcome',
          position: 1,
          titleEn: 'Welcome',
          titleHi: 'स्वागत है',
          bodyEn: 'Ask, show, learn.',
          bodyHi: 'पूछो, दिखाओ, सीखो।',
          active: true,
          version: 1,
        },
      ]),
    })),
    get(/^\/admin\/ustaad\/coachmarks$/, CoachmarkListDto, () => ({
      coachmarks: rows<CoachmarkRow>(c, [
        {
          id: uuid(70),
          target: 'mic',
          textEn: 'Hold to ask',
          textHi: 'दबाकर पूछें',
          position: 1,
          active: true,
          version: 1,
        },
      ]),
    })),
    // G2: the community console shares the page (and its first call, the capabilities).
    ...ustaadConsoleMocks(c),
  ];
}
