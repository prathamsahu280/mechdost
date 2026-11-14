/**
 * Expands the component state model (`model.ts`) into audit cases: one checklist item and one Playwright test
 * each. Deterministic: the same model always yields the same ids (`SHOP-CARD-001` …) in the same order.
 * Pure, with `.ts` imports only (Node runs it for the checklist writer).
 */
import { cross, extendPairs, pairwise, type Param, type Row, type Value } from './pairwise.ts';
import {
  BASE_CHECKS,
  COMPARES,
  COMPONENTS,
  STEPPER,
  type AlignSpec,
  type Check,
  type ComponentDef,
} from './model.ts';

export type Role = 'out' | 'customer' | 'shop' | 'workshop' | 'admin';
export type World = 'empty' | 'cart' | 'busy';

export interface AuditCase {
  /** Stable id, e.g. `SHOP-CARD-017`; every test title starts with it. */
  id: string;
  code: string;
  page: string;
  component: string;
  strategy: 'cross' | 'pairwise';
  path: string;
  scope: string;
  width: number;
  theme: 'light' | 'dark';
  locale: 'en' | 'hi';
  auth: Role;
  world: World;
  /** Component-specific dimension values (cart, compare, stress, interaction, action, open, form, …). */
  state: Readonly<Record<string, string>>;
  checks: readonly Check[];
  align: readonly AlignSpec[];
  sweep: number;
  mustShow: string | null;
  tier: 'core' | 'full';
  /** Needs real sign-in and the API: the demo harness cannot run it (its test is `test.fixme`). */
  realApi: boolean;
}

/**
 * Overnight chunks by page group (`scripts/state-audit-run.mjs`): about 270-450 tests each, one after another on
 * the low-memory machine. Together they cover every id (unit-tested).
 */
export const CHUNKS: Readonly<Record<string, string>> = {
  A: 'CHR-,HOME-',
  B: 'SHOP-,STEP-',
  C: 'PDP-,CMP-,CART-,CHK-',
  D: 'ORD-,SR-,QT-,ACC-,WS-,PTN-,SUP-,LOGIN-,POL-',
  E: 'PRT-,ADM-',
};

const ENV_KEYS = new Set(['width', 'theme', 'locale', 'auth', 'world']);
/** Keys that only choose the route (they are part of `path`, not of the state the harness sets up). */
const ROUTE_KEYS = new Set(['route', 'product', 'order', 'request', 'workshop', 'kind', 'surface']);

function rowsFor(def: ComponentDef): Row[] {
  const valid = def.valid ?? (() => true);
  if (def.strategy === 'pairwise') return pairwise(def.params, { valid });
  const crossNames = new Set(def.cross ?? []);
  const crossed: Param[] = def.params.filter((p) => crossNames.has(p.name));
  const extra: Param[] = def.params.filter((p) => !crossNames.has(p.name));
  return extendPairs(cross(crossed, valid), extra, valid);
}

function resolvePath(def: ComponentDef, row: Row): string {
  const raw = typeof def.path === 'function' ? def.path(row) : def.path;
  if (!raw.includes('{compare}')) return raw;
  const list = COMPARES[String(row.compare ?? 'none')];
  return raw.replace('{compare}', list ? list.slugs.join(',') : '');
}

const str = (v: Value | undefined, fallback: string) => (v === undefined ? fallback : String(v));

function toCase(def: ComponentDef, row: Row, index: number): AuditCase {
  const state: Record<string, string> = {};
  for (const [k, v] of Object.entries(row)) if (!ENV_KEYS.has(k)) state[k] = String(v);
  const locale = str(row.locale, 'en') === 'hi' ? 'hi' : 'en';
  const checks = new Set<Check>(def.checks ?? BASE_CHECKS);
  if (def.align && def.align.length > 0) checks.add('aligned');
  if (locale === 'hi') checks.add('hindi');
  // axe on a sample: every fourth case of a component, and every core case.
  const core = def.core?.(row) ?? false;
  if (index % 4 === 0 || core) checks.add('axe');
  return {
    id: `${def.code}-${String(index + 1).padStart(3, '0')}`,
    code: def.code,
    page: def.page,
    component: def.component,
    strategy: def.strategy,
    path: resolvePath(def, row),
    scope: def.scope,
    width: Number(row.width ?? 1440),
    theme: str(row.theme, 'light') === 'dark' ? 'dark' : 'light',
    locale,
    auth: str(row.auth, 'out') as Role,
    world: str(row.world, 'empty') as World,
    state,
    checks: [...checks],
    align: def.align ?? [],
    sweep: def.sweep ?? 10,
    mustShow: def.mustShow ?? null,
    tier: core ? 'core' : 'full',
    realApi: def.realApi === true,
  };
}

/** Every audit case, in checklist order (components in model order, the stepper cross after the shop pages). */
export function buildCases(): AuditCase[] {
  const defs: ComponentDef[] = [];
  for (const def of COMPONENTS) {
    defs.push(def);
    if (def.code === 'SHOP-TRAY') defs.push(STEPPER);
  }
  const cases: AuditCase[] = [];
  for (const def of defs) rowsFor(def).forEach((row, i) => cases.push(toCase(def, row, i)));
  const ids = new Set<string>();
  for (const c of cases) {
    if (ids.has(c.id)) throw new Error(`duplicate checklist id ${c.id}`);
    ids.add(c.id);
  }
  return cases;
}

const AUTH_TEXT: Readonly<Record<Role, string>> = {
  out: 'signed out',
  customer: 'customer',
  shop: 'shop partner',
  workshop: 'workshop partner',
  admin: 'admin',
};

/** One-line state description used in test titles, checklist lines and failure reports. */
export function describeCase(c: AuditCase): string {
  const dims = Object.entries(c.state)
    .filter(([k]) => !ROUTE_KEYS.has(k) || k === 'surface')
    .map(([k, v]) => `${k}=${v}`);
  return [
    `${String(c.width)}px`,
    c.theme,
    c.locale,
    AUTH_TEXT[c.auth],
    `world=${c.world}`,
    c.path,
    ...dims,
  ].join(' · ');
}

/** Test title: the id first (the ticking script and `--grep` rely on it), then `@core` for the per-push subset. */
export function titleOf(c: AuditCase): string {
  return `${c.id}${c.tier === 'core' ? ' @core' : ''} · ${describeCase(c)}`;
}
