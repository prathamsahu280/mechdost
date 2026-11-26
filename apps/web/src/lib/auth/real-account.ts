import type { DemoRole } from '@/demo/session-state';
import { isStaffGrant } from '@mechdost/shared/auth';

/**
 * The part of `GET /v1/me` the web needs after a real (Firebase) sign-in. Light on purpose: no Firebase import,
 * so screens can use it without loading the SDK.
 */
export interface RealMe {
  name: string | null;
  phone: string | null;
  email: string | null;
  emailVerified: boolean;
  language: string;
  roles: { role: string; shopId: string | null; workshopId: string | null }[];
}

/**
 * Which screen a real account lands on (Q69 default). Staff → admin (the API only lists staff roles for a two-step
 * session); shop owners/staff → the shop portal (Stream C2, 2026-11-14); workshop owners/staff → the workshop
 * portal (Stream E, 2026-11-14), both on the API in real sign-in; delivery agents → the agent portal (spec 24);
 * everyone else → customer.
 */
export function demoRoleFor(me: RealMe): DemoRole {
  // Same rule as the API (`isStaffGrant`): the Ustaad `mechanic` grant names no shop or workshop but is not staff.
  const staff = me.roles.some((r) => isStaffGrant(r));
  if (staff) return 'admin';
  if (me.roles.some((r) => r.shopId !== null)) return 'shop';
  if (me.roles.some((r) => r.workshopId !== null)) return 'workshop';
  // A delivery agent (spec 24): self-scoped grant, lands on the agent portal.
  return me.roles.some((r) => r.role === 'delivery_agent') ? 'delivery_agent' : 'customer';
}
