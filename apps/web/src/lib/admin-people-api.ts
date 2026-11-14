import {
  AuditPageDto,
  CustomerSearchDto,
  CustomerViewDto,
  StaffGrantCreated,
  StaffListDto,
  StaffRevoked,
} from '@mechdost/shared/admin-people-api';
import { adminApi, type AdminResult } from './admin-api';

/**
 * The admin people screens on the MechDost API (real sign-in only; design 2026-11-15): staff and roles, customer
 * search and view, audit log. Every answer is parsed with the shared schemas (hard rule 4); errors come back as
 * the API's code for the screen to translate. Loaded only by those screens (dynamic import).
 */
export const fetchStaff = (locale: string): Promise<AdminResult<StaffListDto>> =>
  adminApi(locale, '/admin/staff', StaffListDto);

export const grantStaff = (
  locale: string,
  body: { phone: string; role: string; cityId: string | null; reason: string },
): Promise<AdminResult<{ grantId: string }>> =>
  adminApi(locale, '/admin/staff/grants', StaffGrantCreated, { method: 'POST', body });

export const revokeStaff = (
  locale: string,
  grantId: string,
  reason: string,
): Promise<AdminResult<{ revoked: true }>> =>
  adminApi(locale, `/admin/staff/grants/${encodeURIComponent(grantId)}/revoke`, StaffRevoked, {
    method: 'POST',
    body: { reason },
  });

export const searchCustomers = (locale: string, q: string): Promise<AdminResult<CustomerSearchDto>> =>
  adminApi(locale, `/admin/customers/search?q=${encodeURIComponent(q)}`, CustomerSearchDto);

export const fetchCustomer = (locale: string, id: string): Promise<AdminResult<CustomerViewDto>> =>
  adminApi(locale, `/admin/customers/${encodeURIComponent(id)}`, CustomerViewDto);

export const AUDIT_FIELDS = ['entity', 'entityId', 'code', 'actor', 'action', 'from', 'to'] as const;
export type AuditQuery = Record<(typeof AUDIT_FIELDS)[number], string>;

/** How many filters are filled in (analytics: a count, never the text). */
export const filledFilters = (q: AuditQuery): number => AUDIT_FIELDS.filter((k) => q[k].trim() !== '').length;

export function fetchAudit(
  locale: string,
  q: AuditQuery,
  cursor?: string,
): Promise<AdminResult<AuditPageDto>> {
  const params = new URLSearchParams({ limit: '30' });
  for (const k of AUDIT_FIELDS) if (q[k].trim() !== '') params.set(k, q[k].trim());
  if (cursor) params.set('cursor', cursor);
  return adminApi(locale, `/admin/audit?${params.toString()}`, AuditPageDto);
}
