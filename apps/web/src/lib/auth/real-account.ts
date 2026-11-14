import type { DemoRole } from '@/demo/session-state';

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
 * portal (Stream E, 2026-11-14), both on the API in real sign-in; everyone else → customer.
 */
export function demoRoleFor(me: RealMe): DemoRole {
  const staff = me.roles.some((r) => r.role !== 'customer' && r.shopId === null && r.workshopId === null);
  if (staff) return 'admin';
  if (me.roles.some((r) => r.shopId !== null)) return 'shop';
  return me.roles.some((r) => r.workshopId !== null) ? 'workshop' : 'customer';
}
