/**
 * Typed fixtures of the support thread audit rows (design 2026-11-15 "Support next tier", items 1 to 3): the customer's
 * Account -> Support screen reached from an order (the thread opener with issue chips and photos, the conversation with
 * photos, the COD refund destination) and the admin inbox conversation (issue badge, photos, the cash on delivery
 * refund panel). Every body carries its shared schema; the images are one tiny PNG answered for `/support-photos/*`.
 */
import { CannedReplyList, SupportAgentList } from '@mechdost/shared/support-inbox';
import {
  SupportInbox,
  SupportInboxTicket,
  SupportOrderChoices,
  SupportTicket,
  SupportTicketList,
} from '@mechdost/shared/support-api';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;
type Ticket = Dto<typeof SupportTicket>;

const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const imageMock: Mock = {
  method: 'GET',
  path: /^\/support-photos\//,
  reply: (): Reply => ({ raw: { contentType: 'image/png', base64: PIXEL } }),
};

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (min: number) => new Date(Date.parse('2026-11-15T10:00:00.000Z') + min * 60_000).toISOString();
const LONG =
  'The brake pad set that arrived is for a different model and the box was crushed on one side when the courier handed it over at the gate';

const meFor = (c: AuditCase): Mock => ({
  method: 'GET',
  path: /^\/me$/,
  reply: (): Reply => ({
    body: {
      name: 'Audit User',
      phone: '+919876543210',
      email: 'audit@example.com',
      emailVerified: true,
      language: c.locale,
      version: 1,
      roles:
        c.auth === 'admin'
          ? [{ role: 'support_agent', shopId: null, workshopId: null }]
          : [{ role: 'customer', shopId: null, workshopId: null }],
    },
  }),
});

function ticket(c: AuditCase): Ticket {
  const state = c.state.tickets ?? 'open-photos';
  const long = c.state.stress === 'long-text';
  const cod = state === 'cod-none' || state === 'cod-saved';
  const photos =
    state === 'open-photos' || cod
      ? [1, 2].map((n) => ({
          id: uuid(500 + n),
          width: 1200,
          height: 800,
          thumbUrl: `/support-photos/${uuid(500 + n)}/thumb?e=9999999999&s=audit`,
          largeUrl: `/support-photos/${uuid(500 + n)}/large?e=9999999999&s=audit`,
        }))
      : [];
  return SupportTicket.parse({
    code: 'REQ-RPR-2026-AB12CD',
    kind: 'order_issue',
    status: state === 'resolved' ? 'resolved' : 'in_review',
    channel: 'web',
    orderCode: 'MD-RPR-2026-ABC123',
    issueCode: 'damaged',
    serviceCode: null,
    refund: {
      eligible: cod,
      destination: state === 'cod-saved' ? { kind: 'upi', masked: 'ra***@okhdfcbank' } : null,
    },
    slaAckDue: at(2_000),
    slaResolveDue: at(40_000),
    resolvedAt: state === 'resolved' ? at(-30) : null,
    createdAt: at(-120),
    version: 2,
    messages: [
      {
        id: uuid(401),
        role: 'customer',
        body: long ? LONG : 'The box was crushed.',
        internal: false,
        channel: 'web',
        createdAt: at(-120),
        attachments: photos,
      },
      {
        id: uuid(402),
        role: 'staff',
        body: 'Thanks, we are checking this with the shop.',
        internal: false,
        channel: 'console',
        createdAt: at(-60),
        attachments: [],
      },
    ],
  });
}

/** Account -> Support from an order link: opener, conversation with photos, COD destination. */
export function accountSupportMocks(c: AuditCase): Mock[] {
  const state = c.state.tickets ?? 'open-photos';
  return [
    meFor(c),
    {
      method: 'GET',
      path: /^\/support\/tickets$/,
      schema: SupportTicketList,
      reply: (): Reply => ({ body: { tickets: state === 'none' ? [] : [ticket(c)] } }),
    },
    {
      method: 'GET',
      path: /^\/orders$/,
      schema: SupportOrderChoices,
      reply: (): Reply => ({ body: { orders: [{ orders: [{ code: 'MD-RPR-2026-ABC123-1' }] }] } }),
    },
    {
      method: 'POST',
      path: /^\/support\/threads$/,
      reply: (): Reply =>
        c.state.form === 'error'
          ? { status: 422, code: 'PHOTO_TYPE' }
          : { status: 201, body: { code: 'REQ-RPR-2026-AB12CD', reopened: false } },
    },
    {
      method: 'PUT',
      path: /^\/support\/tickets\/REQ-[^/]+\/refund-destination$/,
      reply: (): Reply => ({ body: { destination: { kind: 'upi', masked: 'ra***@okhdfcbank' } } }),
    },
    imageMock,
  ];
}

/** The inbox variants of the support tools rows: who asked, who owns it, the first-reply clock, the deletion step. */
function inboxVariant(c: AuditCase) {
  const v = c.state.inbox ?? 'default';
  return {
    guest: v === 'guest',
    deletion: v === 'deletion',
    assigned: v === 'assigned' || v === 'default',
    overdue: v === 'overdue',
  };
}

const AGENTS = [
  { id: uuid(901), name: 'Meera Sahu' },
  { id: uuid(902), name: 'Kiran Verma' },
];

const CANNED = [
  ['looking_into_it', 'Looking into it', 'जाँच कर रहे हैं'],
  ['need_photos', 'Please send photos', 'कृपया फ़ोटो भेजें'],
].map(([key, en, hi], i) => ({
  id: uuid(950 + i),
  key: key ?? '',
  titleEn: en ?? '',
  titleHi: hi ?? '',
  bodyEn: `${en ?? ''}. We will update you here.`,
  bodyHi: `${hi ?? ''}। हम यहीं बताएँगे।`,
  active: true,
  sortOrder: i * 10,
  version: 1,
}));

/** Admin -> Support: the inbox with one open request, its conversation, the tools and the COD refund panel. */
export function adminSupportMocks(c: AuditCase): Mock[] {
  const state = c.state.tickets ?? 'open-photos';
  const variant = inboxVariant(c);
  const base = ticket(c);
  const t = SupportTicket.parse({
    ...base,
    kind: variant.deletion ? 'deletion_request' : base.kind,
    orderCode: variant.deletion || variant.guest ? null : base.orderCode,
    issueCode: variant.deletion || variant.guest ? null : base.issueCode,
  });
  const long = c.state.stress === 'long-text';
  const sla = variant.overdue ? 'overdue' : 'met';
  const customerName = long ? LONG.slice(0, 70) : variant.guest ? 'Mohan Lal' : 'Asha Verma';
  const assignee = variant.assigned ? AGENTS[0] : null;
  const staff = {
    customerName,
    customerPhoneMasked: variant.guest ? '••••••2233' : null,
    isGuest: variant.guest,
    assignee,
    assignedAt: assignee ? at(-90) : null,
    firstRepliedAt: sla === 'met' ? at(-60) : null,
    sla,
    deletionConfirmedAt: null,
  };
  const editor = c.state.canned === 'editor';
  return [
    meFor(c),
    {
      method: 'GET',
      path: /^\/admin\/support\/tickets$/,
      schema: SupportInbox,
      reply: (): Reply => ({
        body: {
          tickets: [
            {
              code: t.code,
              kind: t.kind,
              status: t.status,
              channel: t.channel,
              orderCode: t.orderCode,
              issueCode: t.issueCode,
              serviceCode: null,
              slaAckDue: variant.overdue ? at(-30) : t.slaAckDue,
              slaResolveDue: t.slaResolveDue,
              createdAt: t.createdAt,
              version: t.version,
              acknowledged: state !== 'none' && !variant.overdue,
              firstRepliedAt: staff.firstRepliedAt,
              sla,
              customerName,
              customerPhoneMasked: staff.customerPhoneMasked,
              isGuest: variant.guest,
              assignee,
            },
          ],
        },
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/support\/tickets\/REQ-[^/]+$/,
      schema: SupportInboxTicket,
      reply: (): Reply => ({ body: { ...t, staff } }),
    },
    {
      method: 'GET',
      path: /^\/admin\/support\/agents$/,
      schema: SupportAgentList,
      reply: (): Reply => ({ body: { agents: AGENTS } }),
    },
    {
      method: 'GET',
      path: /^\/admin\/support\/canned-replies$/,
      schema: CannedReplyList,
      reply: (): Reply => ({ body: { replies: CANNED, canEdit: editor } }),
    },
    {
      method: 'POST',
      path: /^\/admin\/support\/tickets\/REQ-[^/]+\/refund$/,
      reply: (): Reply =>
        c.state.form === 'error'
          ? { status: 422, code: 'REFUND_NEEDS_DESTINATION' }
          : { status: 403, code: 'FORBIDDEN' },
    },
    imageMock,
  ];
}

/** Account -> Support deletion card: the request answers "sent", "already open" or refused with its reasons. */
export function accountDeletionMocks(c: AuditCase): Mock[] {
  const mocks = accountSupportMocks({ ...c, state: { ...c.state, tickets: 'none' } });
  const blocked = c.state.deletion === 'blocked';
  return [
    ...mocks,
    {
      method: 'POST',
      path: /^\/support\/deletion-request$/,
      reply: (): Reply =>
        blocked
          ? { status: 409, code: 'DELETION_BLOCKED', details: { blockers: ['OPEN_ORDERS', 'OPEN_REFUND'] } }
          : { status: 201, body: { code: 'REQ-RPR-2026-AB12CD', created: true } },
    },
  ];
}
