import type { AdminSection } from './sections';

/**
 * Which permission opens each admin section (any one of the list), mirrored from the API route guards
 * (`requirePermission` in apps/api/src/routes/admin-*.ts). `null` = every staff member (the overview).
 * The side nav hides what the person cannot use (SIM-B5, DC-B1); the API still refuses every call (hard rule 4),
 * so a wrong entry here can only hide or show a link, never leak data.
 */
export const SECTION_PERMISSIONS: Record<AdminSection, readonly string[] | null> = {
  overview: null,
  analytics: ['analytics:read'],
  orders: ['orders:read'],
  refunds: ['refunds:read'],
  services: ['service:read'],
  roadside: ['roadside:read'],
  delivery: ['delivery_agents:manage', 'delivery_jobs:assign', 'delivery_payouts:manage'],
  quotes: ['quotes:read'],
  applications: ['applications:review'],
  partners: ['partners:read'],
  catalogue: ['products:write'],
  customers: ['customers:read', 'customers:cod_approve'],
  reviews: ['reviews:moderate'],
  support: ['tickets:read'],
  coins: ['coins:read'],
  coupons: ['coupons:write'],
  content: ['content:write'],
  layout: ['content:write'],
  settings: ['settings:read'],
  notifications: ['notifications:manage'],
  staff: ['staff:manage'],
  audit: ['audit:read'],
  exports: ['exports:run'],
  errors: ['settings:read'],
  usage: ['settings:read'],
  ustaad: [
    'ustaad:read',
    'ustaad:moderate',
    'ustaad:verify',
    'ustaad:settings',
    'ustaad:promotions',
    'ustaad:takedown',
  ],
};

/** The sections to list for these permissions; `null` (not known yet, or the demo) lists them all. */
export function sectionsFor<S extends AdminSection>(
  sections: readonly S[],
  permissions: readonly string[] | null,
): S[] {
  if (permissions === null) return [...sections];
  return sections.filter((s) => {
    const need = SECTION_PERMISSIONS[s];
    return need === null || need.some((p) => permissions.includes(p));
  });
}

/** The `permissions` array of a live `/v1/me` answer, checked by hand; anything else is "not known". */
export function permissionsOf(me: unknown): string[] | null {
  if (typeof me !== 'object' || me === null || !('permissions' in me)) return null;
  const { permissions } = me;
  return Array.isArray(permissions) && permissions.every((p): p is string => typeof p === 'string')
    ? permissions
    : null;
}
