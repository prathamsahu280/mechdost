'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  COACHMARK_TARGETS,
  PROMOTION_SLOTS,
  PROMOTION_STATES,
  PROMOTION_TARGETS,
  REPORT_CLOCKS,
  TAG_GROUPS,
  USTAAD_BADGE_KINDS,
  USTAAD_BADGE_RULE_KINDS,
  USTAAD_LEVELS,
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
import { promotionMoveAllowed } from '@mechdost/shared/ustaad/admin-rules';
import { adminApi, type ResponseSchema } from '@/lib/admin-api';
import { adminMessage, type UstaadAdminSection } from '@/lib/admin-ustaad-view';
import {
  emptyForm,
  formFromRow,
  formProblems,
  type TableField,
  type TableForm,
  type TableRow,
  bodyFromForm,
  tableErrorMessage,
} from '@/lib/admin-ustaad-tables';
import { track } from '@/lib/analytics';
import {
  EmptyState,
  StatusBadge,
  adminCard,
  adminTableClass,
  adminTd,
  adminTh,
  AdminTable,
} from '../admin-ui';
import { portalField, portalPrimary, portalQuiet } from '../portal-styles';

type WordList = 'protected' | 'correction' | 'banned' | 'pii_pattern' | 'link_domain' | 'scam_phrase';
type TableId =
  | 'levels'
  | 'badges'
  | 'tags'
  | 'reasons'
  | 'cities'
  | 'promotions'
  | 'cards'
  | 'coachmarks'
  | `words_${WordList}`;

interface TableConfig {
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
  <T,>(path: string, schema: ResponseSchema<T>, pickRows: (d: T) => readonly object[]) =>
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

const wordsTable = (wordList: WordList): TableConfig => ({
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

const TABLES = {
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

const BY_SECTION: Record<UstaadAdminSection, readonly TableConfig[]> = {
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

/** The lists of one section (levels, badges, hashtags, words, reasons, cities, promotions, tutorial). */
export function UstaadSectionTables({
  section,
  canEdit,
  onWordsChanged,
}: {
  section: UstaadAdminSection;
  canEdit: boolean;
  onWordsChanged: () => void;
}) {
  return (
    <>
      {BY_SECTION[section].map((c) => (
        <EditableTable
          key={c.id}
          config={c}
          canEdit={canEdit}
          onSaved={c.id === 'words_protected' ? onWordsChanged : undefined}
        />
      ))}
    </>
  );
}

function EditableTable({
  config,
  canEdit,
  onSaved,
}: {
  config: TableConfig;
  canEdit: boolean;
  onSaved: (() => void) | undefined;
}) {
  const t = useTranslations('ustaad.admin');
  const locale = useLocale();
  const baseId = useId();
  const [rows, setRows] = useState<TableRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  // `null` = no form open, `'new'` = adding, otherwise the id of the row being edited.
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<TableForm>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [merging, setMerging] = useState<{ id: string; into: string } | null>(null);

  const load = useCallback(async () => {
    const r = await config.read(locale);
    setFailed(r === null);
    if (r) setRows(r);
  }, [config, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const label = (field: TableField) => t(adminMessage(`f_${field.label ?? field.name}`));
  const fieldById = (name: string) => config.fields.find((f) => f.name === name);
  const problems = editing ? formProblems(config.fields, form) : {};

  function open(row: TableRow | null) {
    setMessage(null);
    setMerging(null);
    if (row) {
      setEditing(String(row[config.idField]));
      setForm(formFromRow(config.fields, row));
    } else {
      setEditing('new');
      setForm(emptyForm(config.fields));
    }
  }

  async function send(
    method: 'POST' | 'PATCH' | 'PUT',
    path: string,
    body: unknown,
    action: 'create' | 'update' | 'merge' | 'move',
  ) {
    setBusy(true);
    setMessage(null);
    const res = await adminApi(
      locale,
      path,
      { safeParse: (v: unknown) => ({ success: true as const, data: v }) },
      {
        method,
        body,
      },
    );
    setBusy(false);
    if (res.ok) {
      track('admin_ustaad_change', { area: config.id, action, fields: 1 });
      setMessage({ tone: 'ok', text: t('t_saved') });
      setEditing(null);
      setMerging(null);
      onSaved?.();
      await load();
      return;
    }
    setMessage({ tone: 'error', text: t(adminMessage(tableErrorMessage(res.code, res.details))) });
    if (res.status === 409) await load();
  }

  function submit() {
    if (Object.keys(problems).length > 0) {
      setMessage({ tone: 'error', text: t('t_err_invalid') });
      const first = config.fields.find((f) => problems[f.name]);
      if (first) document.getElementById(`${baseId}-${first.name}`)?.focus();
      return;
    }
    const body = { ...bodyFromForm(config.id, config.fields, form), ...config.fixed };
    if (editing === 'new') {
      void send('POST', config.path, body, 'create');
      return;
    }
    const row = rows?.find((r) => String(r[config.idField]) === editing);
    if (!row) return;
    const version = typeof row.version === 'number' ? row.version : null;
    const { list: _list, ...rest } = body as Record<string, unknown>;
    void send(
      config.method,
      `${config.path}/${encodeURIComponent(String(row[config.idField]))}`,
      { ...(config.id.startsWith('words_') ? rest : body), version },
      'update',
    );
  }

  const shown = (row: TableRow, name: string) => {
    const v = row[name];
    const field = fieldById(name);
    if (name === 'status' && typeof v === 'string') return t(adminMessage(`e_promoState_${v}`));
    if (name === 'code' && config.id === 'reasons' && typeof v === 'string')
      return t(adminMessage(`e_reason_${v}`));
    if (typeof v === 'boolean')
      return <StatusBadge tone={v ? 'success' : 'muted'}>{t(v ? 't_active' : 't_inactive')}</StatusBadge>;
    if (field?.kind === 'select' && typeof v === 'string') return t(adminMessage(`e_${field.group}_${v}`));
    if (field?.kind === 'datetime' && typeof v === 'string')
      return new Intl.DateTimeFormat(locale === 'hi' ? 'hi-IN' : 'en-IN', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Kolkata',
      }).format(new Date(v));
    if (typeof v === 'number') return new Intl.NumberFormat(locale === 'hi' ? 'hi-IN' : 'en-IN').format(v);
    return <span data-user-content>{typeof v === 'string' ? v : ''}</span>;
  };

  const titleId = `${baseId}-title`;
  const editable = canEdit;

  return (
    <section aria-labelledby={titleId} className={`${adminCard} space-y-3`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h4 id={titleId} className="font-heading text-base font-extrabold text-ink">
            {t(adminMessage(`tbl_${config.id}`))}
          </h4>
          <p className="mt-0.5 max-w-prose text-sm text-muted">{t(adminMessage(`tbl_${config.id}_help`))}</p>
          {config.id === 'promotions' ? (
            <p className="mt-1 text-xs text-muted">{t('t_sponsored_note')}</p>
          ) : null}
          {config.id === 'cards' ? <p className="mt-1 text-xs text-muted">{t('t_media_later')}</p> : null}
        </div>
        {editable && config.create && editing === null ? (
          <button
            type="button"
            className={portalQuiet}
            onClick={() => {
              open(null);
            }}
          >
            {t('t_add')}
          </button>
        ) : null}
      </div>

      {message ? (
        <p
          role={message.tone === 'error' ? 'alert' : 'status'}
          className={`text-sm font-bold ${message.tone === 'error' ? 'text-error' : 'text-success'}`}
        >
          {message.text}
        </p>
      ) : null}

      {rows === null ? (
        failed ? (
          <p role="alert" className="text-sm font-bold text-error">
            {t('load_error')}{' '}
            <button type="button" className={portalQuiet} onClick={() => void load()}>
              {t('retry')}
            </button>
          </p>
        ) : (
          <div className="skeleton h-16 rounded-card" aria-hidden="true" />
        )
      ) : rows.length === 0 && editing !== 'new' ? (
        <EmptyState
          title={t(
            adminMessage(config.id.startsWith('words_') ? 'tbl_words_empty' : `tbl_${config.id}_empty`),
          )}
        />
      ) : rows.length > 0 ? (
        <AdminTable label={t(adminMessage(`tbl_${config.id}`))}>
          <table className={adminTableClass}>
            <thead>
              <tr>
                {config.columns.map((c) => (
                  <th key={c} scope="col" className={adminTh}>
                    {t(adminMessage(`f_${fieldById(c)?.label ?? (c === 'name' ? 'city' : c)}`))}
                  </th>
                ))}
                {editable ? (
                  <th scope="col" className={adminTh}>
                    <span className="sr-only">{t('t_actions')}</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = String(row[config.idField]);
                const name = typeof row[config.nameField] === 'string' ? String(row[config.nameField]) : id;
                const merged =
                  typeof row.mergedIntoId === 'string'
                    ? rows.find((r) => r.id === row.mergedIntoId)
                    : undefined;
                const status = typeof row.status === 'string' ? row.status : null;
                return (
                  <tr key={id} className="hover:bg-pill/60">
                    {config.columns.map((c) => (
                      <td key={c} className={adminTd}>
                        {shown(row, c)}
                        {c === 'slug' && merged ? (
                          <span className="block text-xs text-muted">
                            {t('t_merged_into', { slug: String(merged.slug) })}
                          </span>
                        ) : null}
                      </td>
                    ))}
                    {editable ? (
                      <td className={`${adminTd} whitespace-nowrap`}>
                        <div className="flex flex-wrap gap-2">
                          {config.id === 'cities' ? (
                            <button
                              type="button"
                              disabled={busy}
                              className={portalQuiet}
                              onClick={() =>
                                void send(
                                  'PUT',
                                  `${config.path}/${id}`,
                                  {
                                    enabled: row.enabled !== true,
                                    version: typeof row.version === 'number' ? row.version : null,
                                  },
                                  'update',
                                )
                              }
                            >
                              {t(row.enabled === true ? 't_city_close' : 't_city_open', { city: name })}
                            </button>
                          ) : status === 'live' || status === 'ended' || merged ? null : (
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={t('t_edit_row', { name })}
                              className={portalQuiet}
                              onClick={() => {
                                open(row);
                              }}
                            >
                              {t('t_edit')}
                            </button>
                          )}
                          {config.id === 'tags' && !merged && row.active === true ? (
                            <button
                              type="button"
                              disabled={busy}
                              className={portalQuiet}
                              onClick={() => {
                                setEditing(null);
                                setMerging({ id, into: '' });
                              }}
                            >
                              {t('t_merge')}
                            </button>
                          ) : null}
                          {config.id === 'promotions' && status
                            ? (['scheduled', 'draft', 'ended'] as const)
                                .filter((to) => isPromotionState(status) && promotionMoveAllowed(status, to))
                                .map((to) => (
                                  <button
                                    key={to}
                                    type="button"
                                    disabled={busy}
                                    className={to === 'scheduled' ? portalPrimary : portalQuiet}
                                    onClick={() =>
                                      void send(
                                        'POST',
                                        `${config.path}/${id}/move`,
                                        { to, version: row.version },
                                        'move',
                                      )
                                    }
                                  >
                                    {t(adminMessage(`t_move_${to}`))}
                                  </button>
                                ))
                            : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </AdminTable>
      ) : null}

      {merging && rows ? (
        <div className="space-y-2 rounded-tile bg-pill p-3">
          <label htmlFor={`${baseId}-merge`} className="text-sm font-bold text-ink">
            {t('t_merge_into')}
          </label>
          <p id={`${baseId}-merge-help`} className="text-xs text-muted">
            {t('t_merge_help')}
          </p>
          <select
            id={`${baseId}-merge`}
            value={merging.into}
            aria-describedby={`${baseId}-merge-help`}
            onChange={(e) => {
              setMerging({ ...merging, into: e.target.value });
            }}
            className={`${portalField} tab:w-72`}
          >
            <option value="">{t('t_choose')}</option>
            {rows
              .filter((r) => r.id !== merging.id && r.active === true && r.mergedIntoId === null)
              .map((r) => (
                <option key={String(r.id)} value={String(r.id)}>
                  #{String(r.slug)}
                </option>
              ))}
          </select>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || merging.into === ''}
              className={portalPrimary}
              onClick={() => {
                const row = rows.find((r) => r.id === merging.id);
                void send(
                  'POST',
                  `${config.path}/${merging.id}/merge`,
                  { intoId: merging.into, version: row?.version },
                  'merge',
                );
              }}
            >
              {t('t_merge')}
            </button>
            <button
              type="button"
              className={portalQuiet}
              onClick={() => {
                setMerging(null);
              }}
            >
              {t('t_cancel')}
            </button>
          </div>
        </div>
      ) : null}

      {editing !== null ? (
        <form
          noValidate
          aria-label={editing === 'new' ? t('t_new') : t('t_edit')}
          className="space-y-3 rounded-tile bg-pill p-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="grid gap-3 tab:grid-cols-2">
            {config.fields.map((f) => {
              const id = `${baseId}-${f.name}`;
              const problem = problems[f.name];
              const errId = `${id}-error`;
              const lang = f.name.endsWith('En') ? 'en' : f.name.endsWith('Hi') ? 'hi' : undefined;
              return (
                <div key={f.name} className={f.kind === 'text' && f.max > 120 ? 'tab:col-span-2' : ''}>
                  {f.kind === 'bool' ? (
                    <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-ink">
                      <input
                        id={id}
                        type="checkbox"
                        checked={form[f.name] === 'true'}
                        onChange={(e) => {
                          setForm({ ...form, [f.name]: e.target.checked ? 'true' : 'false' });
                        }}
                        className="size-5"
                      />
                      {label(f)}
                    </label>
                  ) : (
                    <>
                      <label htmlFor={id} className="text-sm font-bold text-ink">
                        {label(f)}
                      </label>
                      {f.kind === 'select' ? (
                        <select
                          id={id}
                          value={form[f.name] ?? ''}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={problem ? errId : undefined}
                          onChange={(e) => {
                            setForm({ ...form, [f.name]: e.target.value });
                          }}
                          className={portalField}
                        >
                          <option value="">{t('t_choose')}</option>
                          {f.options.map((o) => (
                            <option key={o} value={o}>
                              {t(adminMessage(`e_${f.group}_${o}`))}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id={id}
                          type={f.kind === 'datetime' ? 'datetime-local' : 'text'}
                          inputMode={f.kind === 'number' ? 'numeric' : undefined}
                          lang={lang}
                          autoComplete="off"
                          value={form[f.name] ?? ''}
                          aria-invalid={problem ? true : undefined}
                          aria-describedby={
                            [f.kind === 'list' ? `${id}-help` : '', problem ? errId : '']
                              .filter(Boolean)
                              .join(' ') || undefined
                          }
                          onChange={(e) => {
                            setForm({ ...form, [f.name]: e.target.value });
                          }}
                          className={portalField}
                        />
                      )}
                      {f.kind === 'list' ? (
                        <p id={`${id}-help`} className="mt-1 text-xs text-muted">
                          {t('t_aliases_help')}
                        </p>
                      ) : null}
                    </>
                  )}
                  {problem ? (
                    <p id={errId} className="mt-1 text-sm font-bold text-error">
                      {problem.kind === 'range'
                        ? t('err_range', { min: problem.min, max: problem.max })
                        : t('err_type')}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={portalPrimary}>
              {busy ? t('t_saving') : t('t_save')}
            </button>
            <button
              type="button"
              className={portalQuiet}
              onClick={() => {
                setEditing(null);
                setMessage(null);
              }}
            >
              {t('t_cancel')}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function isPromotionState(s: string): s is (typeof PROMOTION_STATES)[number] {
  return (PROMOTION_STATES as readonly string[]).includes(s);
}
