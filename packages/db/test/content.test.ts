/**
 * Site content (hard rule 8, spec 08): drafts are invisible until published; a city override wins over the
 * global text; English and Hindi are published separately (hard rule 10); every change is compare-and-set,
 * audited, and publishing records a server event; unpublishing returns to the locale-file default.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  events,
  getPublishedContent,
  getPublishedPolicy,
  listContentForAdmin,
  publishContent,
  saveContentDraft,
  unpublishContent,
  type Tx,
} from '../src/repo';
import * as s from '../src/schema';
import { createTestDb, type TestDb } from '../src/testing';

let db: TestDb;
let client: Awaited<ReturnType<typeof createTestDb>>['client'];
const t = () => db as unknown as Tx;
let staff = '';
let raipur = '';

beforeAll(async () => {
  ({ db, client } = await createTestDb());
  const [state] = await db
    .insert(s.states)
    .values({ code: 'CG', name: 'Chhattisgarh', gstStateCode: '22' })
    .returning();
  raipur = (
    await db
      .insert(s.cities)
      .values({ stateId: state!.id, code: 'RPR', slug: 'raipur', name: 'Raipur', status: 'live' })
      .returning()
  )[0]!.id;
  staff = (await db.insert(s.users).values({ firebaseUid: 'fb-content-admin' }).returning())[0]!.id;
});

afterAll(async () => {
  await client.close();
});

const base = { key: 'hero.titleLine1' as const };

describe('site content', () => {
  it('a draft is invisible until published; publishing replaces the live text and removes the draft', async () => {
    const draft = await saveContentDraft(t(), {
      ...base,
      staffUserId: staff,
      locale: 'en',
      cityId: null,
      value: '  Parts\u200b for every   ride  ',
      expectedVersion: null,
    });
    expect(draft.value).toBe('Parts for every ride'); // plain text, cleaned like the demo editor
    expect(await getPublishedContent(t(), { locale: 'en', cityId: null })).toEqual({});

    await expect(
      publishContent(t(), {
        ...base,
        staffUserId: staff,
        locale: 'en',
        cityId: null,
        expectedDraftVersion: draft.version + 1,
      }),
    ).rejects.toMatchObject({ code: 'STALE_CONTENT' });
    await publishContent(t(), {
      ...base,
      staffUserId: staff,
      locale: 'en',
      cityId: null,
      expectedDraftVersion: draft.version,
    });
    expect(await getPublishedContent(t(), { locale: 'en', cityId: null })).toEqual({
      'hero.titleLine1': 'Parts for every ride',
    });
    // Hindi was not published: /hi keeps its own default instead of showing English.
    expect(await getPublishedContent(t(), { locale: 'hi', cityId: null })).toEqual({});
    const entry = (await listContentForAdmin(t(), null)).find(
      (e) => e.key === 'hero.titleLine1' && e.locale === 'en',
    );
    expect(entry).toMatchObject({ draft: null, published: { value: 'Parts for every ride' } });
  });

  it('a city override wins for that city only; unpublishing falls back', async () => {
    const d = await saveContentDraft(t(), {
      ...base,
      staffUserId: staff,
      locale: 'en',
      cityId: raipur,
      value: 'Raipur parts, delivered today',
      expectedVersion: null,
    });
    const live = await publishContent(t(), {
      ...base,
      staffUserId: staff,
      locale: 'en',
      cityId: raipur,
      expectedDraftVersion: d.version,
    });
    expect((await getPublishedContent(t(), { locale: 'en', cityId: raipur }))['hero.titleLine1']).toBe(
      'Raipur parts, delivered today',
    );
    expect((await getPublishedContent(t(), { locale: 'en', cityId: null }))['hero.titleLine1']).toBe(
      'Parts for every ride',
    );
    await expect(
      unpublishContent(t(), {
        ...base,
        staffUserId: staff,
        locale: 'en',
        cityId: raipur,
        expectedVersion: live.version + 1,
      }),
    ).rejects.toMatchObject({ code: 'STALE_CONTENT' });
    await unpublishContent(t(), {
      ...base,
      staffUserId: staff,
      locale: 'en',
      cityId: raipur,
      expectedVersion: live.version,
    });
    expect((await getPublishedContent(t(), { locale: 'en', cityId: raipur }))['hero.titleLine1']).toBe(
      'Parts for every ride',
    );
    await expect(
      unpublishContent(t(), {
        ...base,
        staffUserId: staff,
        locale: 'en',
        cityId: raipur,
        expectedVersion: live.version,
      }),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('refuses empty text and a stale draft; audits every change and records publish events', async () => {
    await expect(
      saveContentDraft(t(), {
        ...base,
        staffUserId: staff,
        locale: 'hi',
        cityId: null,
        value: '   \u0000 ',
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ code: 'CONTENT_EMPTY' });
    const d = await saveContentDraft(t(), {
      ...base,
      staffUserId: staff,
      locale: 'hi',
      cityId: null,
      value: 'हर सवारी के लिए पार्ट्स',
      expectedVersion: null,
    });
    await expect(
      saveContentDraft(t(), {
        ...base,
        staffUserId: staff,
        locale: 'hi',
        cityId: null,
        value: 'दूसरा',
        expectedVersion: null, // a draft already exists: this is a conflict, not a second draft
      }),
    ).rejects.toMatchObject({ code: 'STALE_CONTENT' });
    await saveContentDraft(t(), {
      ...base,
      staffUserId: staff,
      locale: 'hi',
      cityId: null,
      value: 'हर सवारी के लिए असली पार्ट्स',
      expectedVersion: d.version,
    });
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.entity, 'content'));
    expect(audits.map((a) => a.action)).toEqual([
      'content.draft_saved',
      'content.published',
      'content.draft_saved',
      'content.published',
      'content.unpublished',
      'content.draft_saved',
      'content.draft_saved',
    ]);
    const published = await db.select().from(events).where(eq(events.event, 'admin_content_published'));
    expect(published.map((e) => (e.props as { action: string }).action)).toEqual([
      'published',
      'published',
      'unpublished',
    ]);
  });

  it('policies are structured documents with the same draft → publish rules; bad rows never reach a page', async () => {
    const privacy = {
      title: 'Privacy',
      lead: 'What we keep about you.',
      updatedOn: '2026-11-04',
      sections: [{ heading: 'Who we are', body: 'Run by {company}, {address}.', emoji: '🏢' }],
    };
    await expect(
      saveContentDraft(t(), {
        key: 'policy.privacy',
        staffUserId: staff,
        locale: 'en',
        cityId: null,
        value: { ...privacy, lead: 'By {compnay}' },
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ code: 'POLICY_INVALID', details: { problem: 'unknown_placeholder' } });
    await expect(
      saveContentDraft(t(), {
        key: 'policy.privacy',
        staffUserId: staff,
        locale: 'en',
        cityId: null,
        value: 'just a string',
        expectedVersion: null,
      }),
    ).rejects.toMatchObject({ code: 'POLICY_INVALID' });
    const d = await saveContentDraft(t(), {
      key: 'policy.privacy',
      staffUserId: staff,
      locale: 'en',
      cityId: null,
      value: privacy,
      expectedVersion: null,
    });
    expect(await getPublishedPolicy(t(), { key: 'policy.privacy', locale: 'en', cityId: null })).toBeNull();
    await publishContent(t(), {
      key: 'policy.privacy',
      staffUserId: staff,
      locale: 'en',
      cityId: null,
      expectedDraftVersion: d.version,
    });
    expect(await getPublishedPolicy(t(), { key: 'policy.privacy', locale: 'en', cityId: raipur })).toEqual(
      privacy,
    );
    expect(await getPublishedPolicy(t(), { key: 'policy.privacy', locale: 'hi', cityId: null })).toBeNull();
    // Short texts and policies never mix: the public text map has no policy in it.
    expect(Object.keys(await getPublishedContent(t(), { locale: 'en', cityId: null }))).not.toContain(
      'policy.privacy',
    );

    // A row edited by hand into something invalid is treated as missing, not rendered.
    await db
      .update(s.contentBlocks)
      .set({ value: { title: '<script>', sections: 'oops' } })
      .where(eq(s.contentBlocks.key, 'policy.privacy'));
    expect(await getPublishedPolicy(t(), { key: 'policy.privacy', locale: 'en', cityId: null })).toBeNull();
    const entry = (await listContentForAdmin(t(), null)).find(
      (e) => e.key === 'policy.privacy' && e.locale === 'en',
    );
    expect(entry?.published?.value).toBe('');
  });
});
