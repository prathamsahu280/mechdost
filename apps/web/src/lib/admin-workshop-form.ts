import type { AdminWorkshop } from '@mechdost/shared/service-api';
import { CreateWorkshopSchema, UpdateWorkshopSchema } from '@mechdost/shared/service-requests';
import { isVehicleType, type VehicleType } from '@mechdost/shared/vehicles';
import { rupeesToPaise } from './service-views';

/**
 * Admin → Partners → Workshops on the API (Stream E): the editor's form state (strings, as typed) ↔ the API bodies.
 * Validation reuses the shared request schemas (`CreateWorkshopSchema` / `UpdateWorkshopSchema`, hard rule 4) and
 * reports field paths (`name`, `hours`, `menu.2.title`). An edit sends only what changed, so a staff member without
 * approval rights can edit a published workshop (the API refuses `published: true` / `locationVerified: true`
 * from them, even unchanged). Unit-tested in `test/admin-workshop-form.test.ts`.
 */
export interface MenuRow {
  key: string;
  title: string;
  titleHi: string;
  included: string;
  includedHi: string;
  low: string;
  high: string;
  minMinutes: string;
  maxMinutes: string;
  vehicleType: VehicleType | '';
  active: boolean;
}

export interface WorkshopForm {
  slug: string;
  name: string;
  nameHi: string;
  addressLine: string;
  addressLineHi: string;
  area: string;
  areaHi: string;
  pincode: string;
  lat: string;
  lng: string;
  /** 10 digits as typed; sent as +91… */
  phone: string;
  vehicleTypes: VehicleType[];
  evBasic: boolean;
  pickup: boolean;
  open: string;
  close: string;
  days: number[];
  gstin: string;
  locationVerified: boolean;
  published: boolean;
  busy: boolean;
  menu: MenuRow[];
}

export const emptyMenuRow = (): MenuRow => ({
  key: '',
  title: '',
  titleHi: '',
  included: '',
  includedHi: '',
  low: '',
  high: '',
  minMinutes: '30',
  maxMinutes: '60',
  vehicleType: '',
  active: true,
});

export function emptyWorkshopForm(): WorkshopForm {
  return {
    slug: '',
    name: '',
    nameHi: '',
    addressLine: '',
    addressLineHi: '',
    area: '',
    areaHi: '',
    pincode: '',
    lat: '',
    lng: '',
    phone: '',
    vehicleTypes: ['2W'],
    evBasic: false,
    pickup: false,
    open: '09:00',
    close: '19:00',
    days: [1, 2, 3, 4, 5, 6],
    gstin: '',
    locationVerified: false,
    published: false,
    busy: false,
    menu: [],
  };
}

export function formFromWorkshop(w: AdminWorkshop): WorkshopForm {
  return {
    slug: w.slug,
    name: w.name,
    nameHi: w.nameHi ?? '',
    addressLine: w.addressLine,
    addressLineHi: w.addressLineHi ?? '',
    area: w.area,
    areaHi: w.areaHi ?? '',
    pincode: w.pincode,
    lat: String(w.lat),
    lng: String(w.lng),
    phone: w.phone ? w.phone.replace(/^\+91/, '') : '',
    vehicleTypes: [...w.vehicleTypes],
    evBasic: w.evBasic,
    pickup: w.pickup,
    open: w.hours.open,
    close: w.hours.close,
    days: [...w.hours.days],
    gstin: w.gstin ?? '',
    locationVerified: w.locationVerified,
    published: w.published,
    busy: w.busy,
    menu: w.menu.map((m) => ({
      key: m.key,
      title: m.title,
      titleHi: m.titleHi ?? '',
      included: m.included ?? '',
      includedHi: m.includedHi ?? '',
      low: String(m.lowPaise / 100),
      high: String(m.highPaise / 100),
      minMinutes: String(m.minMinutes),
      maxMinutes: String(m.maxMinutes),
      vehicleType: m.vehicleType ?? '',
      active: m.active,
    })),
  };
}

const opt = (s: string) => (s.trim() === '' ? null : s.trim());
/** Typed numbers stay as given when they do not parse, so the schema reports the field instead of a NaN. */
const num = (s: string): number | string => {
  const t = s.trim();
  return t !== '' && Number.isFinite(Number(t)) ? Number(t) : t;
};
const money = (s: string): number | string => rupeesToPaise(s) ?? s;

/** The fields every body shares, in API shape (before validation). */
function fields(f: WorkshopForm) {
  return {
    name: f.name.trim(),
    nameHi: opt(f.nameHi),
    addressLine: f.addressLine.trim(),
    addressLineHi: opt(f.addressLineHi),
    area: f.area.trim(),
    areaHi: opt(f.areaHi),
    pincode: f.pincode.trim(),
    lat: num(f.lat),
    lng: num(f.lng),
    phone: opt(f.phone) === null ? null : `+91${f.phone.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '')}`,
    vehicleTypes: f.vehicleTypes.filter(isVehicleType),
    evBasic: f.evBasic,
    pickup: f.pickup,
    hours: { open: f.open, close: f.close, days: [...f.days].sort((a, b) => a - b) },
    gstin: opt(f.gstin.toUpperCase()),
    locationVerified: f.locationVerified,
    published: f.published,
    menu: f.menu.map((m) => ({
      key: m.key.trim(),
      title: m.title.trim(),
      titleHi: opt(m.titleHi),
      included: opt(m.included),
      includedHi: opt(m.includedHi),
      lowPaise: money(m.low),
      highPaise: money(m.high),
      minMinutes: num(m.minMinutes),
      maxMinutes: num(m.maxMinutes),
      vehicleType: m.vehicleType === '' ? null : m.vehicleType,
      active: m.active,
    })),
  };
}

export type FormErrors = Record<string, true>;

/** Path of a Zod issue as the editor names fields: hours → `hours`, menu lines → `menu.N.field`. */
function fieldPath(path: readonly PropertyKey[]): string {
  const [head, i, field] = path.map(String);
  if (head === 'hours') return 'hours';
  if (head === 'menu' && i !== undefined && field !== undefined) return `menu.${i}.${field}`;
  if (head === 'menu') return 'menu';
  return head ?? 'form';
}

function errorsOf(issues: readonly { path: readonly PropertyKey[] }[]): FormErrors {
  const out: FormErrors = {};
  for (const i of issues) out[fieldPath(i.path)] = true;
  return out;
}

/** Duplicate menu keys (the API answers `MENU_KEY_DUPLICATE`): flag the later rows. */
function duplicateKeys(menu: readonly { key: string }[]): FormErrors {
  const seen = new Set<string>();
  const out: FormErrors = {};
  menu.forEach((m, i) => {
    if (m.key && seen.has(m.key)) out[`menu.${String(i)}.key`] = true;
    seen.add(m.key);
  });
  return out;
}

/** A new workshop's body, or the fields to fix. */
export function createBody(
  f: WorkshopForm,
): { ok: true; body: Record<string, unknown> } | { ok: false; errors: FormErrors } {
  const body = { slug: f.slug.trim(), ...fields(f) };
  const parsed = CreateWorkshopSchema.safeParse(body);
  const dupes = duplicateKeys(body.menu);
  if (!parsed.success) return { ok: false, errors: { ...errorsOf(parsed.error.issues), ...dupes } };
  if (Object.keys(dupes).length > 0) return { ok: false, errors: dupes };
  return { ok: true, body };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The PATCH body for an edit: only the fields that changed (plus `version`), or the fields to fix. `lat` and `lng`
 * always travel together (the API requires both). `changed` is false when there is nothing to save.
 */
export function updateBody(
  original: AdminWorkshop,
  f: WorkshopForm,
): { ok: true; body: Record<string, unknown>; changed: boolean } | { ok: false; errors: FormErrors } {
  const now: Record<string, unknown> = { ...fields(f), busy: f.busy };
  const before: Record<string, unknown> = { ...fields(formFromWorkshop(original)), busy: original.busy };
  const body: Record<string, unknown> = { version: original.version };
  for (const [k, v] of Object.entries(now)) if (!same(v, before[k])) body[k] = v;
  if ('lat' in body || 'lng' in body) {
    body.lat = now.lat;
    body.lng = now.lng;
  }
  const parsed = UpdateWorkshopSchema.safeParse(body);
  const dupes = duplicateKeys(fields(f).menu);
  if (!parsed.success) return { ok: false, errors: { ...errorsOf(parsed.error.issues), ...dupes } };
  if (Object.keys(dupes).length > 0) return { ok: false, errors: dupes };
  return { ok: true, body, changed: Object.keys(body).length > 1 };
}

/** A phone typed as 10 digits (or +91…) → +91XXXXXXXXXX, or null when it is not an Indian mobile number. */
export function memberPhone(text: string): string | null {
  const d = text.replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? `+91${d}` : null;
}
