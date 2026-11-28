/**
 * Typed fixtures of the Admin → Ustaad community console (spec 23 § 21g, task G2). Every body carries its shared schema,
 * so a fixture that drifts from the API contract fails the case. `ustaad=defaults` is a super admin (all cities),
 * `readonly` a Raipur community manager (moderates, no settings), `error` keeps the console working while the settings
 * call fails; `lists=few|empty` fills or empties every queue and list. Phone numbers never appear (SR-38): the owner
 * link's number is a fake audit value.
 */
import {
  ConsoleCapsDto,
  LegalCasesDto,
  ModerationResultDto,
  OwnActionsDto,
  OwnerAttestationQueueDto,
  ReportQueuePageDto,
  ReservedNamesDto,
  StaffMediaUrlDto,
  StaffMemberDetailDto,
  StaffMemberSearchDto,
  ThreadReadDto,
  VerificationQueuePageDto,
} from '@mechdost/shared/ustaad/dto/console';
import { ReportDetailDto, type ReportQueueItem } from '@mechdost/shared/ustaad/dto/moderation';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`;
const few = (c: AuditCase) => (c.state.lists ?? 'few') !== 'empty';
/** A 1x1 PNG served at the staff media URL (the reveal path). */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const iso = (minutesFromNow: number) => new Date(Date.now() + minutesFromNow * 60_000).toISOString();

const get = <S extends { parse(value: unknown): unknown }>(
  path: RegExp,
  schema: S,
  body: () => NoInfer<Dto<S>>,
): Mock => ({ method: 'GET', path, schema, reply: (): Reply => ({ body: body() }) });

function queue(c: AuditCase, kind: string | null): ReportQueueItem[] {
  if (!few(c)) return [];
  const base = {
    targetId: uuid(1),
    source: 'member',
    status: 'open',
    overdue: false,
    minor: false,
    version: 1,
    cityCode: 'RPR',
    banWaiting: false,
    proposedByMe: false,
    decidedByMe: false,
  };
  if (kind === 'held')
    return [
      {
        ...base,
        code: 'UR-RPR-2026-HLDAA2',
        targetType: 'comment',
        reasonCode: 'job_scam',
        source: 'auto_scam',
        clock: 'standard_24h',
        createdAt: iso(-200),
        dueAt: iso(1240),
      },
      {
        ...base,
        code: 'UR-RPR-2026-HLDBB3',
        targetType: 'message',
        reasonCode: 'job_scam',
        source: 'auto_scam',
        clock: 'standard_24h',
        createdAt: iso(-900),
        dueAt: iso(540),
      },
      {
        ...base,
        code: 'UR-RPR-2026-HLDCC4',
        targetType: 'post',
        reasonCode: 'other',
        source: 'auto_word',
        clock: 'standard_24h',
        createdAt: iso(-1500),
        dueAt: iso(-60),
        overdue: true,
      },
    ];
  if (kind === 'appealed')
    return [
      {
        ...base,
        code: 'UR-RPR-2026-APLAA2',
        targetType: 'post',
        reasonCode: 'abuse',
        status: 'appealed',
        clock: 'standard_24h',
        createdAt: iso(-4000),
        dueAt: iso(-2600),
      },
    ];
  return [
    {
      ...base,
      code: 'UR-RPR-2026-MNRAA2',
      targetType: 'member',
      reasonCode: 'minor',
      clock: 'standard_24h',
      createdAt: iso(-30),
      dueAt: iso(1410),
      minor: true,
    },
    {
      ...base,
      code: 'UR-RPR-2026-NCIAA3',
      targetType: 'post',
      reasonCode: 'ncii_impersonation',
      clock: 'intimate_2h',
      createdAt: iso(-80),
      dueAt: iso(40),
    },
    {
      ...base,
      code: 'UR-RPR-2026-ABUAA4',
      targetType: 'answer',
      reasonCode: 'abuse',
      clock: 'standard_24h',
      createdAt: iso(-1300),
      dueAt: iso(140),
      banWaiting: true,
    },
    {
      ...base,
      code: 'UR-RPR-2026-SPMAA5',
      targetType: 'comment',
      reasonCode: 'spam',
      clock: 'standard_24h',
      createdAt: iso(-1500),
      dueAt: iso(-60),
      overdue: true,
    },
  ];
}

export function ustaadConsoleMocks(c: AuditCase): Mock[] {
  const cm = c.state.ustaad === 'readonly';
  return [
    get(/^\/admin\/ustaad\/console$/, ConsoleCapsDto, () => ({
      read: true,
      moderate: true,
      verify: true,
      takedown: true,
      settings: !cm,
      cities: cm ? ['RPR'] : null,
    })),
    {
      method: 'GET',
      path: /^\/admin\/ustaad\/moderation\/reports$/,
      schema: ReportQueuePageDto,
      reply: ({ query }): Reply => ({
        body: { items: queue(c, query.get('queue')), nextCursor: null } satisfies Dto<
          typeof ReportQueuePageDto
        >,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/ustaad\/moderation\/reports\/UR-[A-Z0-9-]+$/,
      schema: ReportDetailDto,
      reply: ({ path }): Reply => {
        const code = path.split('/').pop() ?? '';
        const item = [...queue(c, 'open'), ...queue(c, 'held'), ...queue(c, 'appealed')].find(
          (i) => i.code === code,
        );
        if (!item) return { status: 404, code: 'NOT_FOUND' };
        return {
          body: {
            ...item,
            note: item.source === 'member' ? 'Customer ka number [phone] dikh raha hai photo mein' : null,
            text:
              item.targetType === 'message'
                ? null
                : 'Clutch plate badalne se pehle 500 rupay registration fee bhejo, phir kaam milega.',
            contentStatus: item.source.startsWith('auto_') ? 'held' : 'visible',
            author: {
              memberId: uuid(2),
              handle: 'ramesh_mistri',
              displayName: 'Ramesh Sahu',
              status: 'active',
              restrictedMode: item.minor ? 'minor_report' : 'none',
              activeStrikes: 1,
            },
            mediaIds: item.targetType === 'post' ? [uuid(3), uuid(4)] : [],
            pendingBan: item.banWaiting ? { proposalId: uuid(5), days: 30, proposedByMe: false } : null,
            actions:
              item.status === 'appealed'
                ? [{ action: 'remove', reasonCode: 'abuse', days: null, at: iso(-3000) }]
                : [],
          } satisfies Dto<typeof ReportDetailDto>,
        };
      },
    },
    get(/^\/admin\/ustaad\/moderation\/reports\/[^/]+\/media\/[^/]+$/, StaffMediaUrlDto, () => ({
      url: 'http://127.0.0.1:4100/v1/audit-photo.png',
      expiresAt: iso(2),
      kind: 'image',
      mime: 'image/png',
    })),
    {
      method: 'GET',
      path: /^\/audit-photo\.png$/,
      reply: (): Reply => ({ raw: { contentType: 'image/png', base64: PIXEL } }),
    },
    get(/^\/admin\/ustaad\/moderation\/reports\/[^/]+\/thread$/, ThreadReadDto, () => ({
      reportCode: 'UR-RPR-2026-HLDBB3',
      messages: [
        { id: uuid(6), sender: 'suresh_verma', body: 'Kaam chahiye bhai', at: iso(-60), reported: false },
        {
          id: uuid(7),
          sender: 'ramesh_mistri',
          body: 'Pehle registration fee 500 bhejo',
          at: iso(-50),
          reported: true,
        },
      ],
    })),
    {
      method: 'POST',
      path: /^\/admin\/ustaad\/moderation\/reports\/[^/]+\/(act|ban\/confirm|appeal|appeal\/decide)$/,
      schema: ModerationResultDto,
      reply: (): Reply => ({ body: { code: 'UR-RPR-2026-NCIAA3', status: 'actioned' } }),
    },
    get(/^\/admin\/ustaad\/verifications$/, VerificationQueuePageDto, () => ({
      items: few(c)
        ? [
            {
              id: uuid(8),
              memberId: uuid(9),
              requestedLevel: 'pakka' as const,
              grantedLevel: null,
              status: 'in_review' as const,
              proofKinds: ['owner' as const, 'vouch' as const],
              reasonCode: null,
              attestation: 'confirmed' as const,
              vouchesGiven: 2,
              vouchesNeeded: 2,
              createdAt: iso(-3000),
              decidedAt: null,
              version: 3,
              handle: 'dinesh_auto',
              displayName: 'Dinesh Yadav',
              level: 'naya' as const,
              cityCode: 'RPR',
              yearsClaimed: 8,
            },
          ]
        : [],
      next: null,
    })),
    get(/^\/admin\/ustaad\/attestations$/, OwnerAttestationQueueDto, () => ({
      items: few(c)
        ? [
            {
              id: uuid(10),
              memberHandle: 'kamal_bike',
              memberName: 'Kamal Verma',
              sinceYear: 2019,
              linkIssuedAt: null,
              expiresAt: iso(7 * 1440),
            },
          ]
        : [],
    })),
    get(/^\/admin\/ustaad\/members$/, StaffMemberSearchDto, () => ({
      items: few(c)
        ? [
            {
              memberId: uuid(2),
              handle: 'ramesh_mistri',
              displayName: 'Ramesh Sahu',
              level: 'pakka',
              status: 'restricted',
              verificationState: 'verified',
              restrictedMode: 'none',
              cityCode: 'RPR',
              activeStrikes: 2,
            },
          ]
        : [],
    })),
    get(/^\/admin\/ustaad\/members\/[^/]+$/, StaffMemberDetailDto, () => ({
      memberId: uuid(2),
      handle: 'ramesh_mistri',
      displayName: 'Ramesh Sahu',
      level: 'pakka',
      status: 'restricted',
      verificationState: 'verified',
      restrictedMode: 'none',
      cityCode: 'RPR',
      activeStrikes: 2,
      bannedUntil: null,
      restrictedUntil: iso(5 * 1440),
      joinedAt: iso(-200 * 1440),
      version: 7,
      openReports: 1,
      pendingUnban: null,
      pendingBan: null,
      strikes: [
        { reasonCode: 'spam', status: 'active', at: iso(-2 * 1440) },
        { reasonCode: 'abuse', status: 'active', at: iso(-20 * 1440) },
      ],
      history: [
        {
          action: 'restrict',
          reasonCode: 'spam',
          days: 7,
          targetType: 'member',
          reportCode: 'UR-RPR-2026-STFAA2',
          at: iso(-2 * 1440),
        },
        {
          action: 'warn',
          reasonCode: 'abuse',
          days: null,
          targetType: 'comment',
          reportCode: 'UR-RPR-2026-WRNAA3',
          at: iso(-20 * 1440),
        },
      ],
    })),
    get(/^\/admin\/ustaad\/legal$/, LegalCasesDto, () => ({
      takedowns: few(c)
        ? [
            {
              code: 'UR-RPR-2026-LGLAA2',
              targetType: 'post',
              source: 'legal_order',
              reasonCode: 'other',
              clock: 'legal_3h',
              status: 'actioned',
              dueAt: iso(-1300),
              createdAt: iso(-1480),
              cityCode: 'RPR',
              basis: 'court_order',
            },
          ]
        : [],
      holds: few(c)
        ? [
            {
              id: uuid(11),
              targetType: 'post',
              targetId: uuid(12),
              legalHold: 'legal_order',
              removedAt: iso(-1480),
              files: 2,
              inVault: 2,
            },
          ]
        : [],
    })),
    get(/^\/admin\/ustaad\/reserved-names$/, ReservedNamesDto, () => ({
      names: few(c)
        ? [
            { id: uuid(13), name: 'MechDost', active: true, version: 1 },
            { id: uuid(14), name: 'मैकदोस्त', active: true, version: 1 },
            { id: uuid(15), name: 'Official', active: false, version: 2 },
          ]
        : [],
    })),
    get(/^\/admin\/ustaad\/my-actions$/, OwnActionsDto, () => ({
      items: few(c)
        ? [
            {
              id: '903',
              action: 'ustaad.remove',
              entity: 'ustaad_post',
              reason: 'abuse',
              reportCode: 'UR-RPR-2026-ABUAA4',
              at: iso(-40),
            },
            {
              id: '902',
              action: 'ustaad.media_view',
              entity: 'ustaad_media',
              reason: 'report_review',
              reportCode: 'UR-RPR-2026-NCIAA3',
              at: iso(-45),
            },
            {
              id: '901',
              action: 'ustaad.ban_proposed',
              entity: 'ustaad_report',
              reason: 'abuse',
              reportCode: null,
              at: iso(-300),
            },
          ]
        : [],
      nextCursor: null,
    })),
  ];
}
