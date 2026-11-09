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
 * Which screen a real account lands on while the shop, workshop and admin screens still run on browser data
 * (Q69 default). Staff → admin (the API only lists staff roles for a two-step session); everyone else →
 * customer, including real partners, until the partner portals move to the API (no demo shop behind them).
 */
export function demoRoleFor(me: RealMe): DemoRole {
  const staff = me.roles.some((r) => r.role !== 'customer' && r.shopId === null && r.workshopId === null);
  return staff ? 'admin' : 'customer';
}
