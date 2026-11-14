/**
 * Admin people screens (design 2026-11-15, specs 08/13): staff and roles, customer search and view, audit log
 * viewer. Strict DTOs shared by the API (`admin-staff.ts`, `admin-customers.ts`, `admin-audit.ts`) and the web
 * screens. Money is integer paise, times are ISO strings (shown in IST by the screens).
 */
import { z } from 'zod';

/** Staff roles an admin may grant here (global or one city); shop and workshop roles come with their partner. */
export const STAFF_2FA_STATES = ['ready', 'phone_missing'] as const;

export const StaffGrantDto = z.object({
  grantId: z.uuid(),
  role: z.string(),
  roleName: z.string(),
  cityId: z.uuid().nullable(),
  grantedAt: z.string(),
});

export const StaffMemberDto = z.object({
  userId: z.uuid(),
  name: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  emailMasked: z.string().nullable(),
  status: z.string(),
  /** Latest completed staff sign-in (password and phone code); null = none recorded yet. */
  lastSignInAt: z.string().nullable(),
  /** `ready` = a verified phone can receive the second-step code; `phone_missing` = sign-in cannot finish. */
  twoFactor: z.enum(STAFF_2FA_STATES),
  /** True for the signed-in viewer: the screen offers no change to their own roles. */
  isSelf: z.boolean(),
  grants: z.array(StaffGrantDto),
});

export const StaffRoleOption = z.object({
  key: z.string(),
  name: z.string(),
  scope: z.enum(['global', 'city']),
  /** Only a super admin may grant this role. */
  superAdminOnly: z.boolean(),
});

export const StaffListDto = z.object({
  staff: z.array(StaffMemberDto),
  /** True when more than the first 200 staff accounts exist (the list is capped). */
  truncated: z.boolean(),
  roles: z.array(StaffRoleOption),
  cities: z.array(
    z.object({ id: z.uuid(), code: z.string(), name: z.string(), nameHi: z.string().nullable() }),
  ),
});

export const StaffGrantBody = z
  .object({
    /** The person's phone (E.164 or the 10 digits); they sign up first. */
    phone: z.string().trim().min(10).max(20),
    role: z.string().trim().min(2).max(40),
    cityId: z.uuid().nullable().optional(),
    reason: z.string().trim().min(5).max(300),
  })
  .strict();
export const StaffGrantCreated = z.object({ grantId: z.uuid() });

export const StaffRevokeBody = z.object({ reason: z.string().trim().min(5).max(300) }).strict();
export const StaffRevoked = z.object({ revoked: z.literal(true) });

/** `GET /admin/customers/search?q=` — always masked contact details; the customer view unmasks (audited). */
export const CustomerSearchResultDto = z.object({
  id: z.uuid(),
  name: z.string().nullable(),
  phoneMasked: z.string().nullable(),
  emailMasked: z.string().nullable(),
  status: z.string(),
  createdAt: z.string(),
});
export const CustomerSearchDto = z.object({
  kind: z.enum(['code', 'email', 'phone', 'name']),
  /** At most 20 results. */
  results: z.array(CustomerSearchResultDto),
});

const OrderLine = z.object({
  code: z.string(),
  status: z.string(),
  totalPaise: z.number().int(),
  at: z.string(),
});
const CodeLine = z.object({ code: z.string(), status: z.string(), at: z.string() });

export const CustomerViewDto = z.object({
  profile: z.object({
    id: z.uuid(),
    name: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    /** True when phone and email are masked for this viewer. */
    masked: z.boolean(),
    phoneVerified: z.boolean(),
    emailVerified: z.boolean(),
    status: z.string(),
    language: z.string(),
    createdAt: z.string(),
  }),
  /** Each section is null when the viewer's role has no permission to read it (never an empty list). */
  orders: z.array(OrderLine).nullable(),
  serviceRequests: z.array(CodeLine).nullable(),
  tickets: z.array(CodeLine).nullable(),
  refunds: z
    .array(z.object({ id: z.uuid(), amountPaise: z.number().int(), status: z.string(), at: z.string() }))
    .nullable(),
  coins: z.object({ balance: z.number().int(), lifetimeEarned: z.number().int() }).nullable(),
  consents: z.array(z.object({ purpose: z.string(), granted: z.boolean(), at: z.string() })),
});

export const AUDIT_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,80}$/;

export const AuditRowDto = z.object({
  id: z.number().int(),
  at: z.string(),
  actorUserId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  actorRole: z.string().nullable(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string().nullable(),
  reason: z.string().nullable(),
  /** Contact details inside are masked, always; address and bank fields are hidden. */
  before: z.unknown(),
  after: z.unknown(),
});
export const AuditPageDto = z.object({
  rows: z.array(AuditRowDto),
  nextCursor: z.string().nullable(),
});

export type StaffListDto = z.infer<typeof StaffListDto>;
export type StaffMemberDto = z.infer<typeof StaffMemberDto>;
export type CustomerSearchDto = z.infer<typeof CustomerSearchDto>;
export type CustomerViewDto = z.infer<typeof CustomerViewDto>;
export type AuditRowDto = z.infer<typeof AuditRowDto>;
export type AuditPageDto = z.infer<typeof AuditPageDto>;
