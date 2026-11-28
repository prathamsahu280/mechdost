/**
 * Typed fixtures of the Mechanic Network share teaser, post page (with its sheets) and tag page (spec 23 § 21i-L,
 * batch I) for the API-mode audit. Every body carries the shared schema the screen parses with, so a fixture that
 * drifts from the API contract fails the case (hard rule 4). Sample names only; no phone numbers or real people.
 *
 * Row states: Teaser `teaser=live|gone|member-redirect` (a signed-in member is sent to the post, so that case also
 * answers the post page); Post sheets `post=mine|other|held|gone`, `sheet=none|comments|menu|report|report-error|block|
 * delete` (the page set-up in `hooks.ts` opens the sheet; a sheet that does not exist for the post, such as Block on
 * one's own post, is noted and the page shows as it is); Tag `list=tag-followed|tag-not-followed|tag-empty|
 * tag-unknown`; every row `stress=long-text` for long en and hi names. Nothing here keeps state between calls.
 */
import { PostViewDto } from '@mechdost/shared/ustaad/dto/feed';
import type { CommentView, PostView } from '@mechdost/shared/ustaad/dto/feed';
import { ReportCreatedDto } from '@mechdost/shared/ustaad/dto/moderation';
import {
  CommentPageResponse,
  OpenShareResponse,
  ShareLinkResponse,
  ShareTeaserResponse,
  TagFollowResponse,
  TagPageResponse,
} from '@mechdost/shared/ustaad/dto/responses';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { author, medium, mediaMocks, name, nameHi, post } from './ustaad-social-fixtures.ts';
import { get, iso, MEMBER, meMember, type Out, uuid } from './ustaad-member-fixtures.ts';

const gone = (): Reply => ({ status: 404, code: 'NOT_FOUND' });

// ── The post and its comments ─────────────────────────────────────────────────────────────────────────────────

function postView(c: AuditCase, id: string): PostView {
  const mine = c.state.post === 'mine' || c.state.post === 'held';
  const a = mine
    ? { ...author(c, 9, 'Ramesh Sahu', 'रमेश साहू', 'apprentice'), id: MEMBER.id, handle: MEMBER.handle }
    : author(c, 1, 'Suresh Verma', 'सुरेश वर्मा');
  return post(c, a, {
    id,
    kind: 'text',
    body: name(c, 'Cleaned the carburettor and the idle is smooth again'),
    mine,
    status: c.state.post === 'held' ? 'held' : 'visible',
    counts: { likes: 12, useful: 2, comments: 4, saves: null },
  });
}

function comments(c: AuditCase, postId: string): CommentView[] {
  const who = author(c, 3, 'Imran Khan', 'इमरान खान', 'master');
  const me = {
    ...author(c, 9, 'Ramesh Sahu', 'रमेश साहू', 'apprentice'),
    id: MEMBER.id,
    handle: MEMBER.handle,
  };
  const base = { postId, bodyOriginal: null, correction: 'none', mine: false, status: 'visible' };
  const top = {
    ...base,
    id: uuid(2300),
    parentId: null,
    body: name(c, 'Which jet size did you use for the main jet?'),
    media: null,
    author: who,
    createdAt: iso(80),
  };
  const list: CommentView[] = [
    top,
    {
      ...base,
      id: uuid(2301),
      parentId: top.id,
      body: nameHi(c, 'पैंतीस नंबर का जेट।'),
      media: null,
      author: author(c, 1, 'Suresh Verma', 'सुरेश वर्मा'),
      createdAt: iso(60),
    },
    {
      ...base,
      id: uuid(2302),
      parentId: null,
      body: null,
      media: medium('audio', 20),
      author: who,
      createdAt: iso(40),
    },
  ];
  // A comment of mine that the first check holds back for a person to read: the member sees the note (spec 23 § 13).
  if (c.state.post === 'held')
    list.push({
      ...base,
      id: uuid(2303),
      parentId: null,
      body: 'Thanks, I will try this tomorrow',
      media: null,
      author: me,
      mine: true,
      status: 'held',
      createdAt: iso(10),
    });
  else
    list.push({
      ...base,
      id: uuid(2303),
      parentId: null,
      body: 'Thanks, I will try this tomorrow',
      media: null,
      author: me,
      mine: true,
      createdAt: iso(10),
    });
  return list;
}

function postMocks(): Mock[] {
  return [
    meMember(),
    ...mediaMocks(),
    get(/^\/ustaad\/posts\/[^/]+$/, PostViewDto, (c) => {
      if (c.state.post === 'gone') return gone();
      return { body: postView(c, uuid(2400)) satisfies Out<typeof PostViewDto> };
    }),
    get(/^\/ustaad\/posts\/([^/]+)\/comments$/, CommentPageResponse, (c) => ({
      body: { items: comments(c, uuid(2400)), nextCursor: null } satisfies Out<typeof CommentPageResponse>,
    })),
    {
      method: 'POST',
      path: /^\/ustaad\/reports$/,
      schema: ReportCreatedDto,
      reply: (): Reply => ({
        body: { code: 'REQ-AUDIT-000001', status: 'open' } satisfies Out<typeof ReportCreatedDto>,
      }),
    },
    {
      method: 'POST',
      path: /^\/ustaad\/posts\/[^/]+\/share$/,
      schema: ShareLinkResponse,
      reply: (): Reply => ({
        body: {
          token: 'aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb',
          path: '/ustaad/s/aaaaaaaaaaaaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbb',
        } satisfies Out<typeof ShareLinkResponse>,
      }),
    },
  ];
}

export const ustaadPostSheetsMocks = (): Mock[] => postMocks();

// ── Share teaser ──────────────────────────────────────────────────────────────────────────────────────────────

export const ustaadTeaserMocks = (): Mock[] => [
  ...postMocks(),
  // The public check: is the link live. A visitor sees the card, or "not working" for a bad or removed link.
  get(/^\/ustaad\/s\/[^/]+$/, ShareTeaserResponse, (c) =>
    c.state.teaser === 'gone'
      ? gone()
      : { body: { kind: 'ustaad_post' } satisfies Out<typeof ShareTeaserResponse> },
  ),
  // The member check: only a signed-in member whose link is live is sent on to the post.
  get(/^\/ustaad\/shares\/[^/]+$/, OpenShareResponse, (c) =>
    c.auth === 'customer' && c.state.teaser === 'member-redirect'
      ? { body: { postId: uuid(2400) } satisfies Out<typeof OpenShareResponse> }
      : gone(),
  ),
];

// ── Tag page ──────────────────────────────────────────────────────────────────────────────────────────────────

function tagPage(c: AuditCase): Out<typeof TagPageResponse> {
  const empty = c.state.list === 'tag-empty';
  const a = author(c, 1, 'Suresh Verma', 'सुरेश वर्मा');
  return {
    tag: {
      slug: 'battery',
      nameEn: 'Battery',
      nameHi: 'बैटरी',
      group: 'part',
      followed: c.state.list === 'tag-followed',
    },
    items: empty
      ? []
      : [
          post(c, a, {
            id: uuid(2500),
            body: name(c, 'Battery terminal cleaned and tightened'),
            status: 'visible',
          }),
          post(c, author(c, 2, 'Imran Khan', 'इमरान खान', 'master'), {
            id: uuid(2501),
            kind: 'photo',
            body: 'Weak cell found with a load test',
            media: [medium('image', 21)],
            status: 'visible',
          }),
        ],
    nextCursor: null,
  };
}

export const ustaadTagSavedMocks = (): Mock[] => [
  meMember(),
  ...mediaMocks(),
  get(/^\/ustaad\/tags\/[^/]+$/, TagPageResponse, (c) =>
    c.state.list === 'tag-unknown' ? gone() : { body: tagPage(c) },
  ),
  ...(['PUT', 'DELETE'] as const).map((method): Mock => ({
    method,
    path: /^\/ustaad\/tags\/[^/]+\/follow$/,
    schema: TagFollowResponse,
    reply: (): Reply => ({ body: { followed: method === 'PUT' } satisfies Out<typeof TagFollowResponse> }),
  })),
];
