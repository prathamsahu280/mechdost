/**
 * Admin → Ustaad lists against the API contract (task G1; no e2e here): for every list of the screen, a valid form
 * becomes a body that the API's own Write and Update DTOs accept, and an edit carries over what the form does not
 * show (a promotion's cities and segments, a badge rule's segment) instead of wiping it.
 */
import { describe, expect, it } from 'vitest';
import {
  BadgeUpdateDto,
  BadgeWriteDto,
  CoachmarkUpdateDto,
  CoachmarkWriteDto,
  LevelRuleUpdateDto,
  LevelRuleWriteDto,
  PromotionUpdateDto,
  PromotionWriteDto,
  ReachCityWriteDto,
  ReasonUpdateDto,
  TagUpdateDto,
  TagWriteDto,
  TutorialCardUpdateDto,
  TutorialCardWriteDto,
  WordUpdateDto,
  WordWriteDto,
} from '@mechdost/shared/ustaad/dto/admin';
import { bodyFromForm, formFromRow, type TableField, type TableForm } from '../src/lib/admin-ustaad-tables';
import { BY_SECTION, type TableConfig } from '../src/lib/admin-ustaad-tables-config';

interface Schema {
  safeParse(v: unknown): { success: boolean; error?: unknown };
}

const SAMPLE: Record<string, string> = {
  ruleGroup: 'A',
  code: 'welcome',
  slug: 'battery',
  icon: 'battery',
  ruleTag: 'battery',
  targetId: '/shop/exide',
  aliases: 'battri, batri',
  startsAt: '2026-12-01T09:00',
  endsAt: '2026-12-08T09:00',
};

function validForm(fields: readonly TableField[]): TableForm {
  const out: TableForm = {};
  for (const f of fields) {
    const sample = SAMPLE[f.name];
    if (f.kind === 'bool') out[f.name] = 'true';
    else if (f.kind === 'number') out[f.name] = String(f.min);
    else if (f.kind === 'select') out[f.name] = f.options[0] ?? '';
    else out[f.name] = sample ?? (f.name.endsWith('Hi') ? 'हिंदी' : 'Text');
  }
  return out;
}

const CONTRACT: Partial<Record<string, { write?: Schema; update: Schema }>> = {
  levels: { write: LevelRuleWriteDto, update: LevelRuleUpdateDto },
  badges: { write: BadgeWriteDto, update: BadgeUpdateDto },
  tags: { write: TagWriteDto, update: TagUpdateDto },
  reasons: { update: ReasonUpdateDto },
  cities: { update: ReachCityWriteDto },
  promotions: { write: PromotionWriteDto, update: PromotionUpdateDto },
  cards: { write: TutorialCardWriteDto, update: TutorialCardUpdateDto },
  coachmarks: { write: CoachmarkWriteDto, update: CoachmarkUpdateDto },
};
const contractOf = (id: string) =>
  id.startsWith('words_') ? { write: WordWriteDto, update: WordUpdateDto } : CONTRACT[id];

const configs: TableConfig[] = Object.values(BY_SECTION).flat();

describe('every list form matches the API DTOs', () => {
  it('covers every list of the screen', () => {
    expect(configs.length).toBeGreaterThanOrEqual(14);
    for (const c of configs) expect(contractOf(c.id), c.id).toBeDefined();
  });

  for (const c of configs) {
    it(`${c.id}: create and edit bodies parse`, () => {
      const contract = contractOf(c.id);
      if (!contract) throw new Error(`no contract for ${c.id}`);
      const form = validForm(c.fields);
      if (c.id === 'words_correction') form.replacement = 'battery';
      const body = { ...bodyFromForm(c.id, c.fields, form), ...c.fixed };
      if (contract.write && c.create) {
        const r = contract.write.safeParse(body);
        expect(r.success, `${c.id} write ${JSON.stringify(r.error)}`).toBe(true);
      }
      const { list: _list, ...withoutList } = body as Record<string, unknown>;
      const update = { ...(c.id.startsWith('words_') ? withoutList : body), version: 1 };
      const r = contract.update.safeParse(update);
      expect(r.success, `${c.id} update ${JSON.stringify(r.error)}`).toBe(true);
    });
  }
});

describe('an edit keeps what the form does not show', () => {
  const promotions = configs.find((c) => c.id === 'promotions');
  const badges = configs.find((c) => c.id === 'badges');

  it("a promotion's cities and segments survive an edit", () => {
    if (!promotions) throw new Error('no promotions');
    const row = {
      slot: 'feed',
      titleEn: 'Exide',
      titleHi: 'एक्साइड',
      bodyEn: '',
      bodyHi: '',
      target: 'url_internal',
      targetId: '/shop/exide',
      startsAt: '2026-12-01T00:00:00.000Z',
      endsAt: '2026-12-08T00:00:00.000Z',
      cityIds: ['00000000-0000-4000-8000-000000000040'],
      segmentCodes: ['two_wheeler'],
    };
    const body = bodyFromForm('promotions', promotions.fields, formFromRow(promotions.fields, row), row);
    expect(body.cityIds).toEqual(row.cityIds);
    expect(body.segmentCodes).toEqual(row.segmentCodes);
  });

  it("a badge rule's segment is edited and kept", () => {
    if (!badges) throw new Error('no badges');
    const form = {
      ...validForm(badges.fields),
      ruleKind: 'helpful_answers_in_segment',
      ruleSegment: 'truck_bus',
      ruleTag: '',
    };
    const body = bodyFromForm('badges', badges.fields, form);
    expect(body.rule).toMatchObject({ kind: 'helpful_answers_in_segment', segment: 'truck_bus' });
    expect(BadgeWriteDto.safeParse(body).success).toBe(true);
  });
});
