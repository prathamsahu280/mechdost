/**
 * Discover (spec 23 § 4 flow 8, § 9.4, SR-29, SR-37; workstream D2): people ranked by helpfulness (Wilson of helpful
 * answers, best-answer rate, distinct askers helped, trust, a fading new-member boost; followers weigh 0), with
 * `discover.new_slots` places per page for members under 30 days, 20 a page, a position cursor, no total, and at most
 * `discover.profiles_per_day` profiles a day per member (429). Members with `suggest_me = false` appear only for a
 * typed name search; restricted, banned and left members and anyone blocked either way never appear. Distance is a
 * noisy band (workstream E's `ustaadDistanceBands`) only when the server has a location secret.
 *
 * Tags and top posts are read-only views over workstream A's content tables (posts and tags are written by D1):
 * popular tags in the caller's reach over 14 days, and the week's most saved and liked posts in the caller's city.
 * Spec § 9.5 says "no trending tab" in the feed; this is a Discover section ("Top this week"), recorded in decisions
 * 2026-11-26 "D2" and queued as Q-U-D2a.
 */
import { and, desc, eq, inArray, ne, sql, type SQL } from 'drizzle-orm';
import {
  NAME_KEY_FROM,
  NAME_KEY_TO,
  ustaadNameKey,
  ustaadWorkCodesFor,
} from '@mechdost/shared/ustaad/search';
import type { DiscoverPerson, DiscoverQuery, TopPost } from '@mechdost/shared/ustaad/dto/discover';
import type { UstaadSpecialityCode } from '@mechdost/shared/ustaad/codes';
import { DISCOVER_PAGE_SIZE, discoverScore, rankDiscover } from '@mechdost/shared/ustaad/social-rules';
import {
  cities,
  ustaadMemberCounters,
  ustaadMembers,
  ustaadMemberSpecialities,
  ustaadPostCounters,
  ustaadPosts,
} from '../../schema';
import { DailyCapError, NotFoundError } from '../errors';
import type { Tx } from '../orders';
import { rowsOf } from '../sql-rows';
import { recordUstaadEvent } from './events';
import {
  bumpUstaadDailyCounter,
  ustaadActingMember,
  ustaadMemberCard,
  ustaadMemberCards,
  ustaadNotBlockedSql,
} from './graph-common';
import { ustaadDistanceBands } from './location';
import type { UstaadActor } from './qa';
import { readUstaadSettingValues } from './settings';

const CANDIDATES = 300;
const DAY_MS = 86_400_000;

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function encodeOffset(n: number): string {
  return Buffer.from(`o:${String(n)}`).toString('base64url');
}
function decodeOffset(cursor: string | undefined): number {
  if (!cursor) return 0;
  const m = /^o:(\d{1,5})$/.exec(Buffer.from(cursor, 'base64url').toString('utf8'));
  return m?.[1] ? Number(m[1]) : 0;
}

/** One page of Discover people. See the file header for the rules. */
export async function discoverUstaadPeople(
  db: Tx,
  actor: UstaadActor,
  q: DiscoverQuery,
  opts: { distanceSecret?: string | null } = {},
): Promise<{ items: DiscoverPerson[]; nextCursor: string | null }> {
  return db.transaction(async (tx) => {
    const me = await ustaadActingMember(tx, actor.memberId);
    const s = await readUstaadSettingValues(tx, [
      'ustaad.discover.w_helpful',
      'ustaad.discover.w_best',
      'ustaad.discover.w_breadth',
      'ustaad.discover.w_trust',
      'ustaad.discover.w_new',
      'ustaad.discover.new_slots',
      'ustaad.discover.profiles_per_day',
      'ustaad.feed.show_follower_counts',
    ]);
    let cityId = me.cityId;
    if (q.city) {
      const [c] = await tx.select({ id: cities.id }).from(cities).where(eq(cities.code, q.city)).limit(1);
      if (!c) throw new NotFoundError('City not found');
      cityId = c.id;
    }
    const filters: SQL[] = [
      eq(ustaadMembers.cityId, cityId),
      eq(ustaadMembers.status, 'active'),
      eq(ustaadMembers.restrictedMode, 'none'),
      ne(ustaadMembers.id, me.id),
      ustaadNotBlockedSql(me.id, sql`${ustaadMembers.id}`),
    ];
    if (q.q) {
      const pattern = like(q.q);
      // SIM-P22: the name in the other script (consonant-skeleton key, same map in TS and SQL) and work words.
      const key = ustaadNameKey(q.q);
      // Anchored at a word start: "Ram" (rm) must not hit "Verma" (vrm).
      const wordStart = `% ${like(key).slice(1)}`;
      const keyMatch =
        key.replace(/[^a-z]/g, '').length >= 2
          ? sql` or (' ' || translate(lower(${ustaadMembers.displayName}), ${NAME_KEY_FROM}, ${NAME_KEY_TO})) like ${wordStart}
              or (' ' || translate(lower(coalesce(${ustaadMembers.displayNameHi}, '')), ${NAME_KEY_FROM}, ${NAME_KEY_TO})) like ${wordStart}`
          : sql``;
      const codes = ustaadWorkCodesFor(q.q);
      const workMatch =
        codes.length > 0
          ? sql` or exists (select 1 from ustaad_member_specialities sp where sp.member_id = ${ustaadMembers.id}
              and sp.code in (${sql.join(
                codes.map((c) => sql`${c}`),
                sql`, `,
              )}))`
          : sql``;
      filters.push(
        sql`(${ustaadMembers.displayName} ilike ${pattern} or ${ustaadMembers.handle}::text ilike ${pattern}
          or coalesce(${ustaadMembers.displayNameHi}, '') ilike ${pattern} or ${ustaadMembers.areaLabel} ilike ${pattern}${keyMatch}${workMatch})`,
      );
    } else filters.push(eq(ustaadMembers.suggestMe, true));
    if (q.level) filters.push(eq(ustaadMembers.level, q.level));
    if (q.work)
      filters.push(
        sql`exists (select 1 from ustaad_member_specialities sp where sp.member_id = ${ustaadMembers.id} and sp.code = ${q.work})`,
      );
    const rows = await tx
      .select({ m: ustaadMembers, c: ustaadMemberCounters })
      .from(ustaadMembers)
      .leftJoin(ustaadMemberCounters, eq(ustaadMemberCounters.memberId, ustaadMembers.id))
      .where(and(...filters))
      .orderBy(desc(sql`coalesce(${ustaadMemberCounters.helpfulAnswers}, 0)`), ustaadMembers.id)
      .limit(CANDIDATES);
    const ids = rows.map((r) => r.m.id);
    const askers = new Map<string, number>();
    if (ids.length > 0) {
      const res = await tx.execute(sql`select a.author_id, count(distinct q.asker_id)::int as n
        from ustaad_answers a join ustaad_questions q on q.id = a.question_id
        where a.status = 'visible' and a.author_id in (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) group by a.author_id`);
      for (const r of rowsOf<{ author_id: string; n: unknown }>(res)) askers.set(r.author_id, Number(r.n));
    }
    const weights = {
      helpful: Number(s['ustaad.discover.w_helpful']),
      best: Number(s['ustaad.discover.w_best']),
      breadth: Number(s['ustaad.discover.w_breadth']),
      trust: Number(s['ustaad.discover.w_trust']),
      newcomer: Number(s['ustaad.discover.w_new']),
    };
    const now = Date.now();
    const byId = new Map(rows.map((r) => [r.m.id, r]));
    const scored = rows.map((r) => {
      const days = (now - r.m.joinedAt.getTime()) / DAY_MS;
      return {
        id: r.m.id,
        isNew: days < 30,
        score: discoverScore(
          {
            answers: r.c?.answers ?? 0,
            helpfulAnswers: r.c?.helpfulAnswers ?? 0,
            bestAnswers: r.c?.bestAnswers ?? 0,
            bestAnswers30d: r.c?.bestAnswers30d ?? 0,
            distinctAskers: askers.get(r.m.id) ?? 0,
            verified: r.m.verificationState === 'verified',
            level: r.m.level,
            daysSinceJoin: days,
            followers: r.c?.followers ?? 0,
          },
          weights,
        ),
      };
    });
    const page = rankDiscover(scored, {
      newSlots: Number(s['ustaad.discover.new_slots']),
      offset: decodeOffset(q.cursor),
    });
    if (
      page.ids.length > 0 &&
      !(await bumpUstaadDailyCounter(
        tx,
        me.id,
        'profiles_served',
        page.ids.length,
        Number(s['ustaad.discover.profiles_per_day']),
      ))
    )
      throw new DailyCapError('You have seen enough profiles for today', 'USTAAD_DAILY_CAP');
    const specs = page.ids.length
      ? await tx
          .select({ memberId: ustaadMemberSpecialities.memberId, code: ustaadMemberSpecialities.code })
          .from(ustaadMemberSpecialities)
          .where(inArray(ustaadMemberSpecialities.memberId, page.ids))
      : [];
    const bands = opts.distanceSecret
      ? await ustaadDistanceBands(tx, me.id, page.ids, opts.distanceSecret)
      : new Map<string, never>();
    const showFollowers = s['ustaad.feed.show_follower_counts'] === true;
    const isNew = new Map(scored.map((x) => [x.id, x.isNew]));
    const items: DiscoverPerson[] = [];
    for (const id of page.ids) {
      const r = byId.get(id);
      if (!r) continue;
      items.push({
        ...ustaadMemberCard(r.m),
        specialities: specs.filter((x) => x.memberId === id).map((x) => x.code as UstaadSpecialityCode),
        followers: showFollowers ? (r.c?.followers ?? 0) : null,
        helpfulAnswers: r.c?.helpfulAnswers ?? 0,
        bestAnswers: r.c?.bestAnswers ?? 0,
        isNew: isNew.get(id) ?? false,
        distanceBand: bands.get(id) ?? null,
      });
    }
    await recordUstaadEvent(
      tx,
      {
        entityType: 'member',
        entityId: me.id,
        kind: 'discover_served',
        actorId: actor.userId,
        actorRole: 'member',
        props: { results: items.length },
      },
      {
        name: 'ustaad_discover_served',
        memberId: me.id,
        userId: actor.userId,
        props: { results: items.length, filters: [q.q, q.work, q.level, q.city].filter(Boolean).length },
      },
    );
    return { items, nextCursor: page.nextOffset === null ? null : encodeOffset(page.nextOffset) };
  });
}

/** Popular active tags in the caller's reach over the last 14 days (posts and questions), at most 20. */
export async function discoverUstaadTags(
  db: Tx,
  actor: UstaadActor,
): Promise<{ items: { slug: string; nameEn: string; nameHi: string; uses: number }[] }> {
  const me = await ustaadActingMember(db, actor.memberId);
  const res = await db.execute(sql`
    select t.slug, t.name_en, t.name_hi, count(*)::int as uses
    from ustaad_post_tags pt
    join ustaad_tags t on t.id = pt.tag_id and t.active and t.merged_into_id is null
    left join ustaad_posts p on p.id = pt.post_id
    left join ustaad_questions q on q.id = pt.question_id
    where pt.created_at > now() - interval '14 days'
      and (
        (p.id is not null and p.status = 'visible' and p.city_id = ${me.cityId}
          and ${ustaadNotBlockedSql(me.id, sql`p.author_id`)})
        or (q.id is not null and q.status <> 'removed' and (q.city_id = ${me.cityId} or q.reach = 'state')
          and ${ustaadNotBlockedSql(me.id, sql`q.asker_id`)})
      )
    group by t.slug, t.name_en, t.name_hi
    order by uses desc, t.slug
    limit 20`);
  return {
    items: rowsOf<{ slug: string; name_en: string; name_hi: string; uses: unknown }>(res).map((r) => ({
      slug: r.slug,
      nameEn: r.name_en,
      nameHi: r.name_hi,
      uses: Number(r.uses),
    })),
  };
}

/** The read interface D1's tables satisfy: top posts of the week in the caller's city. */
export interface UstaadTopPostsQuery {
  /** Default 7 days. */
  days?: number;
  /** Default 20, at most 20. */
  limit?: number;
}

/**
 * "Top this week" in Discover: visible member posts (no stories, no MechDost or sponsored content) in the caller's
 * city, ranked by saves (×2) and likes, authors blocked either way or muted by the caller left out.
 */
export async function ustaadTopPosts(
  db: Tx,
  actor: UstaadActor,
  q: UstaadTopPostsQuery,
): Promise<{ items: TopPost[] }> {
  const me = await ustaadActingMember(db, actor.memberId);
  const s = await readUstaadSettingValues(db, ['ustaad.feed.show_like_counts']);
  const days = Math.min(Math.max(q.days ?? 7, 1), 14);
  const rows = await db
    .select({
      id: ustaadPosts.id,
      kind: ustaadPosts.kind,
      authorId: ustaadPosts.authorId,
      createdAt: ustaadPosts.createdAt,
      likes: ustaadPostCounters.likes,
      saves: ustaadPostCounters.saves,
    })
    .from(ustaadPosts)
    .innerJoin(ustaadPostCounters, eq(ustaadPostCounters.postId, ustaadPosts.id))
    .innerJoin(ustaadMembers, eq(ustaadMembers.id, ustaadPosts.authorId))
    .where(
      and(
        eq(ustaadPosts.cityId, me.cityId),
        eq(ustaadPosts.status, 'visible'),
        ne(ustaadPosts.kind, 'story'),
        eq(ustaadPosts.contentType, 'ugc'),
        sql`${ustaadPosts.createdAt} > now() - make_interval(days => ${days})`,
        eq(ustaadMembers.status, 'active'),
        ustaadNotBlockedSql(me.id, sql`${ustaadPosts.authorId}`),
        sql`not exists (select 1 from ustaad_mutes mu where mu.member_id = ${me.id} and mu.target_id = ${ustaadPosts.authorId})`,
      ),
    )
    .orderBy(
      desc(sql`${ustaadPostCounters.saves} * 2 + ${ustaadPostCounters.likes}`),
      desc(ustaadPosts.createdAt),
    )
    .limit(Math.min(Math.max(q.limit ?? DISCOVER_PAGE_SIZE, 1), DISCOVER_PAGE_SIZE));
  const cards = await ustaadMemberCards(
    db,
    rows.map((r) => r.authorId),
  );
  const showLikes = s['ustaad.feed.show_like_counts'] === true;
  const items: TopPost[] = [];
  for (const r of rows) {
    const author = cards.get(r.authorId);
    if (author)
      items.push({
        id: r.id,
        kind: r.kind as TopPost['kind'],
        author,
        likes: showLikes ? r.likes : null,
        saves: r.saves,
        createdAt: r.createdAt.toISOString(),
      });
  }
  return { items };
}
