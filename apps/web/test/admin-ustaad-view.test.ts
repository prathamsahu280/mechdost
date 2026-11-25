/**
 * Admin → Ustaad Network (spec 23 § 15; task G1): every registry key sits in exactly one of the ten sections and has a
 * label, a one-line help, its unit and (enums) an option label in English and Hindi; locked items are read-only and
 * never sent; the screen finds the same invariant problems as the server; a video above 180 s asks for a reason; the
 * admin frame ships the namespaces and the side bar has the "Ustaad Network" group.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { USTAAD_LOCKED_ITEMS } from '@mechdost/shared/ustaad/admin-rules';
import {
  USTAAD_SETTINGS,
  USTAAD_SETTING_KEYS,
  type UstaadSettingSpec,
} from '@mechdost/shared/ustaad/settings';
import { ADMIN_NAV_GROUPS } from '../src/lib/admin-nav-groups';
import {
  ACCESS_KEY,
  USTAAD_ADMIN_SECTIONS,
  changesOf,
  fieldProblems,
  flatKey,
  isLockedKey,
  keysOfSection,
  needsVideoReason,
  riskOf,
  sectionFromQuery,
  sectionOfKey,
  unitOf,
  type SavedRow,
} from '../src/lib/admin-ustaad-view';
import { ALL_ADMIN_SECTIONS } from '../src/lib/sections';
import {
  bodyFromForm,
  formFromRow,
  formProblems,
  tableErrorMessage,
  type TableField,
} from '../src/lib/admin-ustaad-tables';
import { pickMessages } from '../src/lib/pick-messages';

type Messages = Record<string, unknown>;
const messages = (lang: 'en' | 'hi') =>
  JSON.parse(
    readFileSync(
      join(__dirname, '..', '..', '..', 'packages', 'shared', 'src', 'i18n', `${lang}.json`),
      'utf8',
    ),
  ) as Messages;
const ns = (lang: 'en' | 'hi') =>
  (messages(lang).ustaad as Record<string, Record<string, string>>).admin ?? {};
const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');

const saved: SavedRow[] = USTAAD_SETTING_KEYS.map((key) => ({
  key,
  value: USTAAD_SETTINGS[key].default,
  version: null,
}));
const opts = { superAdmin: true, reasonCode: '', protectedWords: 5 };

describe('sections', () => {
  it('puts every key except the access switch in exactly one of the ten sections', () => {
    expect(USTAAD_ADMIN_SECTIONS.length).toBe(10);
    for (const key of USTAAD_SETTING_KEYS) {
      if (key === ACCESS_KEY) expect(sectionOfKey(key)).toBeNull();
      else expect(USTAAD_ADMIN_SECTIONS, key).toContain(sectionOfKey(key));
    }
    const placed = USTAAD_ADMIN_SECTIONS.flatMap((s) => keysOfSection(s));
    expect(placed.length).toBe(USTAAD_SETTING_KEYS.length - 1);
  });

  it('opens the section named by ?sec= and the first one otherwise', () => {
    expect(sectionFromQuery('promo')).toBe('promo');
    expect(sectionFromQuery('nope')).toBe('general');
    expect(sectionFromQuery(null)).toBe('general');
  });
});

describe('texts in English and Hindi', () => {
  for (const lang of ['en', 'hi'] as const) {
    it(`${lang}: every key has a label and a help line; every enum value and unit has a label`, () => {
      const m = ns(lang);
      const missing: string[] = [];
      for (const key of USTAAD_SETTING_KEYS) {
        const f = flatKey(key);
        for (const id of [`lbl_${f}`, `help_${f}`]) if (!m[id]) missing.push(id);
        const spec: UstaadSettingSpec = USTAAD_SETTINGS[key];
        if (spec.kind === 'enum')
          for (const v of spec.values) if (!m[`opt_${f}_${v}`]) missing.push(`opt_${f}_${v}`);
        const unit = unitOf(key);
        if (unit && !m[`unit_${unit}`]) missing.push(`unit_${unit}`);
      }
      for (const s of USTAAD_ADMIN_SECTIONS)
        for (const id of [`sec_${s}`, `sec_${s}_help`]) if (!m[id]) missing.push(id);
      for (const l of USTAAD_LOCKED_ITEMS)
        for (const id of [`lbl_${flatKey(l.item)}`, `help_${flatKey(l.item)}`]) if (!m[id]) missing.push(id);
      for (const id of [
        'inv_feed_weights',
        'inv_discover_weights',
        'inv_locked',
        'inv_zones_hide_below',
        'inv_zones_exact_from',
        'inv_promo_every_n',
        'inv_posts_video_max_s',
        'inv_correction_default_mode',
        'risk_access',
        'risk_network_off',
        'risk_video',
        'risk_feature_off',
        'reason_founder_request',
        'reason_training_content',
        'reason_pilot',
      ])
        if (!m[id]) missing.push(id);
      expect(missing).toEqual([]);
    });
  }

  it('Hindi texts are not copies of the English ones', () => {
    const en = ns('en');
    const hi = ns('hi');
    const same = Object.keys(en).filter(
      (k) =>
        !k.startsWith('unit_') &&
        typeof en[k] === 'string' &&
        en[k] === hi[k] &&
        /[a-z]{4}/i.test(en[k] ?? ''),
    );
    expect(same).toEqual([]);
  });

  it('the side bar names the section and the group in both languages', () => {
    for (const lang of ['en', 'hi'] as const) {
      const portal = messages(lang).portal as Record<string, string>;
      expect(portal.nav_ustaad, lang).toBeTruthy();
      expect(portal.adminHeader_ustaad, lang).toBeTruthy();
      expect(portal.navGroup_ustaad, lang).toBeTruthy();
    }
  });
});

describe('locked items (SR-8, SR-29, SR-41)', () => {
  it('locked registry switches are read-only and never part of a save', () => {
    const locked = USTAAD_SETTING_KEYS.filter(isLockedKey);
    expect(locked).toEqual(
      expect.arrayContaining([
        'ustaad.general.mechanics_only',
        'ustaad.mod.minor_report_restricts',
        'ustaad.jobs.never_charge_candidates',
      ]),
    );
    expect(changesOf(saved, { 'ustaad.general.mechanics_only': 'false' })).toEqual([]);
  });
});

describe('save', () => {
  it('sends only what changed, with the version it was read at', () => {
    const rows = saved.map((r) => (r.key === 'ustaad.posts.per_day' ? { ...r, version: 3 } : r));
    expect(changesOf(rows, { 'ustaad.posts.per_day': '20', 'ustaad.posts.max_photos': '4' })).toEqual([
      { key: 'ustaad.posts.max_photos', value: 4, version: null },
    ]);
    expect(changesOf(rows, { 'ustaad.posts.per_day': '25' })).toEqual([
      { key: 'ustaad.posts.per_day', value: 25, version: 3 },
    ]);
  });

  it('finds the invariants the server enforces (hide_below 4, every_n 7, weights 99)', () => {
    expect(fieldProblems(saved, { 'ustaad.zones.hide_below': '4' }, opts)['ustaad.zones.hide_below']).toEqual(
      {
        kind: 'invariant',
        message: 'inv_zones_hide_below',
      },
    );
    expect(fieldProblems(saved, { 'ustaad.promo.every_n': '7' }, opts)['ustaad.promo.every_n']).toMatchObject(
      {
        kind: 'invariant',
      },
    );
    expect(fieldProblems(saved, { 'ustaad.feed.w_city': '24' }, opts)['ustaad.feed.w_city']).toEqual({
      kind: 'relation',
      message: 'inv_feed_weights',
    });
    expect(
      fieldProblems(saved, { 'ustaad.posts.max_photos': '11' }, opts)['ustaad.posts.max_photos'],
    ).toEqual({
      kind: 'range',
      min: 1,
      max: 10,
    });
  });

  it('a video above 180 s needs a super admin and a reason', () => {
    const draft = { 'ustaad.posts.video_max_s': '240' };
    expect(needsVideoReason(changesOf(saved, draft))).toBe(true);
    expect(fieldProblems(saved, draft, opts)['ustaad.posts.video_max_s']).toMatchObject({
      kind: 'invariant',
    });
    expect(
      fieldProblems(saved, draft, { ...opts, reasonCode: 'pilot' })['ustaad.posts.video_max_s'],
    ).toBeUndefined();
    expect(
      fieldProblems(saved, draft, { ...opts, superAdmin: false, reasonCode: 'pilot' })[
        'ustaad.posts.video_max_s'
      ],
    ).toMatchObject({ kind: 'invariant' });
  });

  it('asks to confirm the access switch, the network off and a long video', () => {
    expect(riskOf({ key: 'ustaad.access', value: 'open', version: null })).toBe('risk_access');
    expect(riskOf({ key: 'ustaad.general.enabled', value: false, version: null })).toBe('risk_network_off');
    expect(riskOf({ key: 'ustaad.posts.video_max_s', value: 240, version: null })).toBe('risk_video');
    expect(riskOf({ key: 'ustaad.posts.per_day', value: 5, version: null })).toBeNull();
  });
});

describe('admin frame', () => {
  it('has the ustaad section in a group of its own, real sign-in only', () => {
    expect(ALL_ADMIN_SECTIONS).toContain('ustaad');
    expect(ADMIN_NAV_GROUPS.find((g) => g.id === 'ustaad')?.sections).toEqual(['ustaad']);
    expect(read('lib/sections.ts')).toMatch(/REAL_SIGN_IN_ONLY[\s\S]*'ustaad'/);
  });

  it('ships the ustaad.admin and ustaad.adminAccess messages to the admin pages', () => {
    const layout = read('app/[locale]/admin/layout.tsx');
    expect(layout).toContain("'ustaad.admin'");
    expect(layout).toContain("'ustaad.adminAccess'");
  });
});

describe('list forms (levels, badges, hashtags, words, promotions)', () => {
  const fields: TableField[] = [
    { name: 'slug', kind: 'text', max: 40, pattern: '^[a-z0-9][a-z0-9_]{1,39}$' },
    { name: 'position', kind: 'number', min: 0, max: 100 },
    { name: 'active', kind: 'bool' },
    { name: 'aliases', kind: 'list', max: 40, optional: true },
    { name: 'startsAt', kind: 'datetime' },
  ];

  it('round-trips a row through the form (times shown in IST)', () => {
    const form = formFromRow(fields, {
      slug: 'battery',
      position: 2,
      active: true,
      aliases: ['battri', 'batri'],
      startsAt: '2026-12-01T00:00:00.000Z',
    });
    expect(form).toEqual({
      slug: 'battery',
      position: '2',
      active: 'true',
      aliases: 'battri, batri',
      startsAt: '2026-12-01T05:30',
    });
    expect(bodyFromForm('tags', fields, form)).toEqual({
      slug: 'battery',
      position: 2,
      active: true,
      aliases: ['battri', 'batri'],
      startsAt: '2026-12-01T00:00:00.000Z',
    });
  });

  it('flags a bad pattern, an out-of-range number and a missing required field', () => {
    expect(
      formProblems(fields, { slug: '#bad', position: '101', active: 'true', aliases: '', startsAt: '' }),
    ).toEqual({
      slug: { kind: 'type' },
      position: { kind: 'range', min: 0, max: 100 },
      startsAt: { kind: 'type' },
    });
  });

  it('builds the typed badge rule, and promotions never carry a label', () => {
    const badge = bodyFromForm(
      'badges',
      [
        { name: 'ruleKind', kind: 'select', options: ['best_answers_with_tag'], group: 'ruleKind' },
        { name: 'ruleTag', kind: 'text', max: 40, optional: true },
        { name: 'ruleCount', kind: 'number', min: 1, max: 100, optional: true },
      ],
      { ruleKind: 'best_answers_with_tag', ruleTag: 'battery', ruleCount: '10' },
    );
    expect(badge).toEqual({
      rule: { schema_version: 1, kind: 'best_answers_with_tag', tag: 'battery', count: 10 },
    });
    const promo = bodyFromForm('promotions', [{ name: 'titleEn', kind: 'text', max: 80 }], {
      titleEn: 'Exide',
    });
    expect(promo).toEqual({ titleEn: 'Exide', cityIds: [], segmentCodes: [] });
    expect('label' in promo).toBe(false);
  });

  it('maps the API codes to messages that exist in both languages', () => {
    const cases: [string, unknown, string][] = [
      ['DUPLICATE', undefined, 't_err_duplicate'],
      ['STALE', undefined, 't_err_stale'],
      ['SETTING_INVARIANT', { key: 'needsStaffReview' }, 't_err_staff_review'],
      ['SETTING_INVARIANT', { key: 'other' }, 't_err_other_reason'],
      ['SETTING_INVARIANT', { key: 'ustaad.promo.label' }, 't_err_label'],
      ['SETTING_INVARIANT', { key: 'ustaad.correction.default_mode' }, 't_err_last_protected'],
      ['TAG_MERGE', undefined, 't_err_tag_merge'],
      ['BAD_MOVE', undefined, 't_err_bad_move'],
      ['HTTP_500', undefined, 't_err_generic'],
    ];
    for (const [code, details, id] of cases) {
      expect(tableErrorMessage(code, details)).toBe(id);
      for (const lang of ['en', 'hi'] as const) expect(ns(lang)[id], `${lang} ${id}`).toBeTruthy();
    }
  });

  it('every field label and option of the lists exists in both languages', () => {
    const src = read('components/portal/admin-ustaad/ustaad-tables.tsx');
    const names = new Set<string>();
    for (const m of src.matchAll(/(?:text|num|bool|select)\('([A-Za-z]+)'/g)) names.add(m[1] ?? '');
    for (const m of src.matchAll(/label: '([A-Za-z]+)'/g)) names.add(m[1] ?? '');
    names.add('city');
    const groups = new Map<string, string[]>();
    for (const m of src.matchAll(/select\('[A-Za-z]+', ([A-Z_]+), '([A-Za-z]+)'\)/g))
      groups.set(m[2] ?? '', []);
    expect(names.size).toBeGreaterThan(30);
    expect(groups.size).toBeGreaterThan(7);
    for (const lang of ['en', 'hi'] as const) {
      const m = ns(lang);
      expect(
        [...names].filter((n) => !m[`f_${n}`]),
        lang,
      ).toEqual([]);
      for (const g of [...groups.keys(), 'coachTarget', 'promoState', 'reason'])
        expect(
          Object.keys(m).some((k) => k.startsWith(`e_${g}_`)),
          `${lang} e_${g}`,
        ).toBe(true);
    }
  });
});

describe('client messages', () => {
  it('picks a part of a namespace (ustaad.admin) without the rest of it', () => {
    const picked = pickMessages(
      { ustaad: { admin: { a: '1' }, feed: { b: '2' }, adminAccess: { c: '3' } }, portal: { d: '4' } },
      ['ustaad.admin', 'ustaad.adminAccess', 'portal'],
    );
    expect(picked).toEqual({ ustaad: { admin: { a: '1' }, adminAccess: { c: '3' } }, portal: { d: '4' } });
  });
});
