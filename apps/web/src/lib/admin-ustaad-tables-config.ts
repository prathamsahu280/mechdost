/**
 * The Admin → Ustaad lists as data (task G1): fields, columns, paths and which section shows them. Kept outside the
 * client component so a node test can build a request body from each config and check it against the API's DTOs.
 */
import {
  COACHMARK_TARGETS,
  PROMOTION_SLOTS,
  PROMOTION_TARGETS,
  REPORT_CLOCKS,
  TAG_GROUPS,
  USTAAD_BADGE_KINDS,
  USTAAD_BADGE_RULE_KINDS,
  USTAAD_LEVELS,
  USTAAD_SEGMENT_CODES,
} from '@mechdost/shared/ustaad/codes';
import {
  BadgeListDto,
  CoachmarkListDto,
  LevelRuleListDto,
  PromotionListDto,
  ReachCityListDto,
  ReasonListDto,
  TagListDto,
  TutorialCardListDto,
  WORD_LANGS,
  WordListDto,
} from '@mechdost/shared/ustaad/dto/admin';
import { adminApi, type ResponseSchema } from './admin-api';
import type { TableField, TableRow } from './admin-ustaad-tables';
import type { UstaadAdminSection } from './admin-ustaad-view';

export type WordList = 'protected' | 'correction' | 'banned' | 'pii_pattern' | 'link_domain' | 'scam_phrase';
export type TableId =
  | 'levels'
  | 'badges'
  | 'tags'
  | 'reasons'
  | 'cities'
  | 'promotions'
  | 'cards'
  | 'coachmarks'
  | `words_${WordList}`;

export interface TableConfig {
  /** `tbl_<id>` texts and the analytics area. */
  id: TableId;
  path: string;
  read: (locale: string) => Promise<TableRow[] | null>;
  fields: readonly TableField[];
  /** Fields shown as table columns (the rest only in the form). */
  columns: readonly string[];
  /** Row id in the URL (`id`, `code`, `cityId`). */
  idField: string;
  /** The name read out for a row ("Edit #battery"). */
  nameField: string;
  create: boolean;
  /** PATCH for most tables; PUT for the reach cities. */
  method: 'PATCH' | 'PUT';
  /** Words: the list this table shows and creates in. */
  fixed?: Record<string, string>;
}

const list =
  <T>(path: string, schema: ResponseSchema<T>, pickRows: (d: T) => readonly object[]) =>
  async (locale: string): Promise<TableRow[] | null> => {
    const res = await adminApi(locale, path, schema);
    return res.ok ? pickRows(res.data).map((r) => ({ ...r })) : null;
  };

const text = (
  name: string,
  max: number,
  extra: { optional?: boolean; pattern?: string } = {},
): TableField => ({
  name,
  kind: 'text',
  max,
  ...extra,
});
const num = (name: string, min: number, max: number): TableField => ({ name, kind: 'number', min, max });
const bool = (name: string): TableField => ({ name, kind: 'bool' });
const select = (name: string, options: readonly string[], group: string): TableField => ({
  name,
  kind: 'select',
  options,
  group,
});

export const wordsTable = (wordList: WordList): TableConfig => ({
  id: `words_${wordList}`,
  path: '/admin/ustaad/words',
  read: async (locale) => {
    const rows = await list('/admin/ustaad/words', WordListDto, (d) => d.words)(locale);
    return rows?.filter((r) => r.list === wordList) ?? null;
  },
  fields: [
    text('phrase', 120),
    ...(wordList === 'correction' ? [text('replacement', 120)] : []),
    select('lang', WORD_LANGS, 'wordLang'),
    bool('active'),
  ],
  columns: wordList === 'correction' ? ['phrase', 'replacement', 'active'] : ['phrase', 'lang', 'active'],
  idField: 'id',
  nameField: 'phrase',
  create: true,
  method: 'PATCH',
  fixed: { list: wordList },
});

export const TABLES = {
  levels: {
    id: 'levels',
    path: '/admin/ustaad/levels',
    read: list('/admin/ustaad/levels', LevelRuleListDto, (d) => d.levels),
    fields: [
      select('level', USTAAD_LEVELS, 'level'),
      text('ruleGroup', 1, { pattern: '^[A-Z]$' }),
      text('nameEn', 40),
      text('nameHi', 60),
      num('minFollowers', 0, 100_000),
      num('minBestAnswers', 0, 100_000),
      num('minHelpfulPct', 0, 100),
      num('minVerifiedYears', 0, 50),
      num('minVideos', 0, 100_000),
      num('minRecommendations', 0, 100_000),
      bool('needsStaffReview'),
      text('perkEn', 200, { optional: true }),
      text('perkHi', 300, { optional: true }),
      num('coinMultiplierBp', 10_000, 30_000),
      num('position', 0, 100),
    ],
    columns: ['level', 'ruleGroup', 'minFollowers', 'minBestAnswers', 'minHelpfulPct', 'needsStaffReview'],
    idField: 'id',
    nameField: 'nameEn',
    create: true,
    method: 'PATCH',
  },
  badges: {
    id: 'badges',
    path: '/admin/ustaad/badges',
    read: list('/admin/ustaad/badges', BadgeListDto, (d) =>
      d.badges.map((b) => ({
        ...b,
        ruleKind: b.rule.kind,
        ruleTag: b.rule.tag ?? '',
        ruleSegment: b.rule.segment ?? '',
        ruleCount: b.rule.count ?? '',
      })),
    ),
    fields: [
      text('code', 41, { pattern: '^[a-z][a-z0-9_]{1,40}$' }),
      text('nameEn', 60),
      text('nameHi', 90),
      text('ruleEn', 200),
      text('ruleHi', 300),
      text('icon', 40, { pattern: '^[a-z0-9-]{1,40}$' }),
      select('kind', USTAAD_BADGE_KINDS, 'badgeKind'),
      select('ruleKind', USTAAD_BADGE_RULE_KINDS, 'ruleKind'),
      text('ruleTag', 40, { optional: true, pattern: '^[a-z0-9][a-z0-9_]{1,39}$' }),
      {
        name: 'ruleSegment',
        kind: 'select',
        options: USTAAD_SEGMENT_CODES,
        group: 'segment',
        optional: true,
      },
      { name: 'ruleCount', kind: 'number', min: 1, max: 10_000, optional: true },
      bool('active'),
    ],
    columns: ['code', 'nameEn', 'kind', 'active'],
    idField: 'id',
    nameField: 'nameEn',
    create: true,
    method: 'PATCH',
  },
  tags: {
    id: 'tags',
    path: '/admin/ustaad/tags',
    read: list('/admin/ustaad/tags', TagListDto, (d) => d.tags),
    fields: [
      text('slug', 40, { pattern: '^[a-z0-9][a-z0-9_]{1,39}$' }),
      text('nameEn', 60),
      text('nameHi', 90),
      select('group', TAG_GROUPS, 'tagGroup'),
      { name: 'aliases', kind: 'list', max: 40, optional: true },
      bool('active'),
    ],
    columns: ['slug', 'nameHi', 'group', 'posts', 'active'],
    idField: 'id',
    nameField: 'slug',
    create: true,
    method: 'PATCH',
  },
  reasons: {
    id: 'reasons',
    path: '/admin/ustaad/reasons',
    read: list('/admin/ustaad/reasons', ReasonListDto, (d) => d.reasons),
    fields: [
      text('labelEn', 80),
      text('labelHi', 120),
      select('defaultClock', REPORT_CLOCKS, 'clock'),
      bool('active'),
    ],
    columns: ['code', 'labelHi', 'defaultClock', 'active'],
    idField: 'code',
    nameField: 'labelEn',
    create: false,
    method: 'PATCH',
  },
  cities: {
    id: 'cities',
    path: '/admin/ustaad/reach-cities',
    read: list('/admin/ustaad/reach-cities', ReachCityListDto, (d) => d.cities),
    fields: [bool('enabled')],
    columns: ['name', 'enabled'],
    idField: 'cityId',
    nameField: 'name',
    create: false,
    method: 'PUT',
  },
  promotions: {
    id: 'promotions',
    path: '/admin/ustaad/promotions',
    read: list('/admin/ustaad/promotions', PromotionListDto, (d) => d.promotions),
    fields: [
      select('slot', PROMOTION_SLOTS, 'slot'),
      text('titleEn', 80),
      text('titleHi', 120),
      text('bodyEn', 200, { optional: true }),
      text('bodyHi', 300, { optional: true }),
      select('target', PROMOTION_TARGETS, 'target'),
      text('targetId', 300),
      { name: 'startsAt', kind: 'datetime' },
      { name: 'endsAt', kind: 'datetime' },
    ],
    columns: ['titleHi', 'slot', 'startsAt', 'endsAt', 'status'],
    idField: 'id',
    nameField: 'titleEn',
    create: true,
    method: 'PATCH',
    fixed: {},
  },
  cards: {
    id: 'cards',
    path: '/admin/ustaad/tutorial-cards',
    read: list('/admin/ustaad/tutorial-cards', TutorialCardListDto, (d) => d.cards),
    fields: [
      text('code', 41, { pattern: '^[a-z][a-z0-9_]{1,40}$' }),
      num('position', 0, 100),
      text('titleEn', 80),
      text('titleHi', 120),
      text('bodyEn', 300),
      text('bodyHi', 400),
      bool('active'),
    ],
    columns: ['position', 'code', 'titleHi', 'active'],
    idField: 'id',
    nameField: 'titleEn',
    create: true,
    method: 'PATCH',
  },
  coachmarks: {
    id: 'coachmarks',
    path: '/admin/ustaad/coachmarks',
    read: list('/admin/ustaad/coachmarks', CoachmarkListDto, (d) => d.coachmarks),
    fields: [
      {
        name: 'target',
        kind: 'select',
        options: COACHMARK_TARGETS,
        group: 'coachTarget',
        label: 'coachTarget',
      },
      text('textEn', 140),
      text('textHi', 200),
      num('position', 0, 100),
      bool('active'),
    ],
    columns: ['position', 'target', 'textHi', 'active'],
    idField: 'id',
    nameField: 'textEn',
    create: true,
    method: 'PATCH',
  },
} satisfies Record<string, TableConfig>;

export const BY_SECTION: Record<UstaadAdminSection, readonly TableConfig[]> = {
  general: [TABLES.cards, TABLES.coachmarks],
  levels: [TABLES.levels, TABLES.badges],
  verify: [],
  posts: [],
  corr: [wordsTable('protected'), wordsTable('correction')],
  loc: [TABLES.cities],
  feed: [TABLES.tags],
  promo: [TABLES.promotions],
  mod: [TABLES.reasons, wordsTable('banned'), wordsTable('pii_pattern'), wordsTable('link_domain')],
  jobs: [wordsTable('scam_phrase')],
};
