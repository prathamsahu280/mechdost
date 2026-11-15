/**
 * RBAC catalogue — single source of truth for permissions and system roles
 * (docs/specs/13-rbac-security-abuse.md, docs/research/ecommerce-baseline.md §7).
 * The database tables `permissions`, `roles` and `role_permissions` are synced from this file by the seed;
 * the API resolves a user's grants from the database on every request (claims are only a UI hint).
 */

export const PERMISSIONS = {
  'account:read': 'Read own profile, addresses and vehicles',
  'account:write': 'Edit own profile, addresses and vehicles',
  'orders:place': 'Place product orders',
  'orders:read': 'Read orders in scope',
  'orders:route': 'Route orders to shops, reroute or reject them',
  'orders:cancel': 'Cancel orders on behalf of customers',
  'orders:fulfil': 'Pack, ship and deliver orders assigned to the shop',
  'orders:export': 'Export order data',
  'assignments:respond': 'Accept or decline orders offered to the shop',
  'inventory:write': 'Edit stock, prices and coverage for the shop',
  'service:request': 'Create service requests',
  'service:read': 'Read service requests in scope',
  'service:route': 'Route service requests to workshops',
  'service:respond': 'Propose slots or decline service requests offered to the workshop',
  'service:work': 'Run job cards: vehicle received, estimates, progress, bills',
  'service_menu:write': 'Edit the workshop service menu, hours and photos',
  'quotes:request': 'Ask MechDost for a bulk price and negotiate it',
  'quotes:read': 'Read bulk quotes in scope',
  'quotes:negotiate': 'Reply to bulk quotes, send price offers and withdraw quotes',
  'returns:request': 'Request returns or replacements',
  'returns:review': 'Approve or reject returns and replacements',
  'refunds:read': 'Read refunds',
  'refunds:initiate': 'Initiate refunds up to the approval threshold',
  'refunds:approve': 'Approve refunds above the threshold (four-eyes)',
  'payments:read': 'Read payments and reconciliation',
  'payouts:read': 'Read partner payouts and settlements',
  'payouts:manage': 'Create and release partner payouts',
  'invoices:read': 'Read invoices and credit notes',
  'gst:export': 'Export GST and TCS reports',
  'products:write': 'Create and edit products, photos and fitments',
  'prices:write': 'Set customer prices per city and PIN code',
  'products:publish': 'Publish or unpublish products',
  'products:import': 'Bulk import products',
  'categories:write': 'Edit categories and brands',
  'partners:read': 'Read shops, workshops and mechanics',
  'partners:write': 'Edit partner profiles',
  'partners:approve': 'Approve, verify, suspend or publish partners',
  'prices:approve': 'Approve or reject prices that sellers ask for',
  'applications:review': 'Review partner applications',
  'customers:read': 'Read customer accounts with masked contact details',
  'customers:read_pii': 'Read unmasked customer phone numbers and emails',
  'customers:block': 'Block or unblock customers',
  'tickets:create': 'Open support tickets',
  'tickets:read': 'Read support tickets in scope',
  'tickets:reply': 'Reply to support tickets and add internal notes',
  'tickets:assign': 'Assign and escalate support tickets',
  'reviews:write': 'Write reviews for own orders and services',
  'reviews:moderate': 'Approve, edit or hide reviews',
  'content:write': 'Edit site content, banners, FAQ and policies',
  'content:publish': 'Publish site content',
  'coupons:write': 'Create and edit coupons and campaigns',
  'coins:read': 'Read customer MechDost Coins balances and history',
  'coins:adjust': 'Grant or deduct MechDost Coins by hand (audited)',
  'coins:rules': 'Edit how MechDost Coins are earned, redeemed and expire',
  'notifications:manage': 'Edit notification templates and send test messages',
  'settings:read': 'Read platform and city settings',
  'settings:write': 'Edit platform and city settings',
  'flags:write': 'Edit feature flags and kill switches',
  'cities:manage': 'Launch cities and manage pincodes',
  'staff:manage': 'Invite, deactivate and scope staff',
  'roles:manage': 'Edit roles and permissions',
  'audit:read': 'Read the audit log',
  'exports:run': 'Download CSV exports of orders, refunds, service requests, partners and customers',
  'analytics:read': 'Read dashboards and reports',
} as const satisfies Record<string, string>;

export type Permission = keyof typeof PERMISSIONS;

/** Which identifier a grant of this role must carry (enforced by the role-assignment service). */
export type RoleScope = 'global' | 'city' | 'shop' | 'workshop' | 'self';

interface RoleDefinition {
  readonly name: string;
  readonly description: string;
  readonly scope: RoleScope;
  readonly staff: boolean;
  readonly permissions: readonly Permission[];
}

const ALL = Object.keys(PERMISSIONS) as Permission[];

const CUSTOMER: readonly Permission[] = [
  'account:read',
  'account:write',
  'orders:place',
  'service:request',
  'quotes:request',
  'returns:request',
  'tickets:create',
  'reviews:write',
];

const OPS: readonly Permission[] = [
  'orders:read',
  'orders:route',
  'orders:cancel',
  'orders:export',
  'exports:run',
  'service:read',
  'service:route',
  'quotes:read',
  'quotes:negotiate',
  'returns:review',
  'refunds:read',
  'refunds:initiate',
  'payments:read',
  'invoices:read',
  'partners:read',
  'partners:write',
  'partners:approve',
  'applications:review',
  'customers:read',
  'tickets:read',
  'tickets:reply',
  'tickets:assign',
  'settings:read',
  'analytics:read',
  'coins:read',
];

export const ROLES = {
  super_admin: {
    name: 'Super admin',
    description: 'Full control over the platform',
    scope: 'global',
    staff: true,
    permissions: ALL,
  },
  ops_manager: {
    name: 'Operations manager',
    description: 'Routing, orders, service requests, partners and returns',
    scope: 'global',
    staff: true,
    // Prices (shop costs, customer prices, seller price requests) are super admin + catalogue manager only
    // (user 2026-11-14).
    permissions: OPS,
  },
  city_manager: {
    name: 'City manager',
    description: 'Operations for the assigned city only',
    scope: 'city',
    staff: true,
    permissions: [...OPS, 'cities:manage', 'content:write'],
  },
  support_agent: {
    name: 'Support agent',
    description: 'Tickets and customer help with masked contact details',
    scope: 'global',
    staff: true,
    permissions: [
      'orders:read',
      'service:read',
      'refunds:read',
      'refunds:initiate',
      'invoices:read',
      'customers:read',
      'tickets:read',
      'tickets:reply',
      'partners:read',
      'coins:read',
    ],
  },
  finance: {
    name: 'Finance',
    description: 'Payments, refunds approval, payouts and GST',
    scope: 'global',
    staff: true,
    permissions: [
      'orders:read',
      'orders:export',
      'exports:run',
      'refunds:read',
      'refunds:initiate',
      'refunds:approve',
      'payments:read',
      'payouts:read',
      'payouts:manage',
      'invoices:read',
      'gst:export',
      'partners:read',
      'analytics:read',
      'audit:read',
      'coins:read',
    ],
  },
  catalogue_manager: {
    name: 'Catalogue manager',
    description: 'Products, categories, brands, fitments and imports',
    scope: 'global',
    staff: true,
    permissions: [
      'products:write',
      'products:publish',
      'products:import',
      'categories:write',
      'partners:read',
      // Shop costs and customer prices, and seller price requests (user 2026-11-14).
      'prices:write',
      'prices:approve',
      'reviews:moderate',
      'analytics:read',
    ],
  },
  marketing: {
    name: 'Marketing',
    description: 'Content, coupons, campaigns and notifications',
    scope: 'global',
    staff: true,
    permissions: [
      'content:write',
      'content:publish',
      'coupons:write',
      'coins:read',
      // Coin grants and deductions are super admin only (user 2026-11-14); marketing keeps the rules.
      'coins:rules',
      'notifications:manage',
      'reviews:moderate',
      'analytics:read',
    ],
  },
  seller_owner: {
    name: 'Shop owner',
    description: 'Runs a shop: orders, stock, staff',
    scope: 'shop',
    staff: false,
    permissions: [
      'orders:read',
      'assignments:respond',
      'orders:fulfil',
      'inventory:write',
      'returns:review',
      'payouts:read',
      'invoices:read',
      'tickets:create',
      'tickets:read',
    ],
  },
  seller_staff: {
    name: 'Shop staff',
    description: 'Handles a shop’s orders and stock',
    scope: 'shop',
    staff: false,
    permissions: ['orders:read', 'assignments:respond', 'orders:fulfil', 'inventory:write', 'tickets:create'],
  },
  workshop_owner: {
    name: 'Workshop owner',
    description: 'Runs a workshop: requests, job cards, menu, staff',
    scope: 'workshop',
    staff: false,
    permissions: [
      'service:read',
      'service:respond',
      'service:work',
      'service_menu:write',
      'payouts:read',
      'invoices:read',
      'tickets:create',
      'tickets:read',
    ],
  },
  workshop_staff: {
    name: 'Workshop staff',
    description: 'Handles a workshop’s requests and job cards',
    scope: 'workshop',
    staff: false,
    permissions: ['service:read', 'service:respond', 'service:work', 'tickets:create'],
  },
  mechanic: {
    name: 'Mechanic',
    description: 'Mechanic network member (P2 portal)',
    scope: 'self',
    staff: false,
    permissions: ['account:read', 'account:write', 'tickets:create'],
  },
  customer: {
    name: 'Customer',
    description: 'Every signed-in user; implicit, never stored per user',
    scope: 'self',
    staff: false,
    permissions: CUSTOMER,
  },
} as const satisfies Record<string, RoleDefinition>;

export type RoleKey = keyof typeof ROLES;
export const ROLE_KEYS = Object.keys(ROLES) as RoleKey[];
export const CUSTOMER_ROLE = 'customer' satisfies RoleKey;

export function isPermission(value: string): value is Permission {
  return Object.hasOwn(PERMISSIONS, value);
}

export function isRoleKey(value: string): value is RoleKey {
  return Object.hasOwn(ROLES, value);
}

/**
 * One role held by a user, optionally limited to a city, shop or workshop (mirrors `user_roles`).
 * `permissions` come from the database (`role_permissions`), so admin-defined custom roles work too.
 */
export interface Grant {
  role: string;
  permissions: readonly Permission[];
  cityId: string | null;
  shopId: string | null;
  workshopId: string | null;
}

/** Every signed-in user implicitly holds the customer role; it is never stored per user. */
export function customerGrant(): Grant {
  return {
    role: CUSTOMER_ROLE,
    permissions: ROLES.customer.permissions,
    cityId: null,
    shopId: null,
    workshopId: null,
  };
}

/** The thing being acted on; omitted fields are not checked (the repository must still scope its query). */
export interface Target {
  cityId?: string | null;
  shopId?: string | null;
  workshopId?: string | null;
}

function named(value: string | null | undefined): value is string {
  return value !== undefined && value !== null;
}

function covers(grantValue: string | null, target: string | null | undefined): boolean {
  if (grantValue === null) return true; // unscoped on this axis
  if (!named(target)) return true; // caller did not name a target on this axis
  return grantValue === target;
}

/** Does any grant give `permission` over `target`? Pure; used by API middleware and services. */
export function can(grants: readonly Grant[], permission: Permission, target: Target = {}): boolean {
  return grants.some(
    (g) =>
      g.permissions.includes(permission) &&
      covers(g.cityId, target.cityId) &&
      covers(g.shopId, target.shopId) &&
      covers(g.workshopId, target.workshopId) &&
      // A shop grant never covers a workshop target and vice versa.
      !(g.shopId !== null && named(target.workshopId)) &&
      !(g.workshopId !== null && named(target.shopId)),
  );
}

/** Union of permissions across grants (for `/v1/me` and UI hints — never for authorization of a target). */
export function permissionsOf(grants: readonly Grant[]): Set<Permission> {
  const out = new Set<Permission>();
  for (const g of grants) for (const p of g.permissions) out.add(p);
  return out;
}
