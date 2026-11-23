import { ERA_EN, ERA_HI, yearText, type BatteryFitment } from './era';
import { FUEL_EN, FUEL_HI } from './hindi';
import { cmp, titleVehicle } from './text';

/** Fitment shown in the searchable text: this many vehicles, then "and N more" (the full list is in `spec.fitment`). */
export const COMPATIBILITY_CAP = 40;

/** Vehicle type codes of `spec.fitment`, in the order a list is sorted. */
export const FITMENT_TYPE_ORDER = [
  'car_suv_muv',
  'lcv_hcv',
  'tractor',
  'earth_moving',
  'two_wheeler',
  'three_wheeler',
  'genset',
] as const;

const typeOrder = (t: string) => {
  const i = (FITMENT_TYPE_ORDER as readonly string[]).indexOf(t);
  return i < 0 ? 9 : i;
};

/** One battery's fitment list, sorted by vehicle type, make, model, fuel and year. */
export function sortFitment(list: BatteryFitment[]): void {
  list.sort(
    (a, b) =>
      typeOrder(a.type) - typeOrder(b.type) ||
      cmp(a.make, b.make) ||
      cmp(a.model, b.model) ||
      cmp(a.fuel ?? '', b.fuel ?? '') ||
      (a.yearFrom ?? 0) - (b.yearFrom ?? 0),
  );
}

/** Lower-case words of the makes and models of a list: Latin by rule 10 ("brand and model names"). */
export function addVehicleWords(list: readonly BatteryFitment[], into: Set<string>): void {
  for (const e of list)
    for (const w of `${titleVehicle(e.make)} ${titleVehicle(e.model)}`.match(/[A-Za-z]{3,}/g) ?? [])
      into.add(w.toLowerCase());
}

function labels(fit: readonly BatteryFitment[], hi: boolean): string[] {
  const fuelWords = hi ? FUEL_HI : FUEL_EN;
  const eraWords = hi ? ERA_HI : ERA_EN;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of fit) {
    const base = `${titleVehicle(e.make)} ${titleVehicle(e.model)}`;
    const detail = [
      e.fuel ? (fuelWords[e.fuel] ?? '') : null,
      e.era ? eraWords[e.era] : null,
      yearText(e, hi),
    ].filter((d): d is string => d !== null && d !== '');
    const label = detail.length > 0 ? `${base} (${detail.join(', ')})` : base;
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  }
  return out;
}

function fitText(list: string[], more: (n: number) => string): string | null {
  return list.length === 0
    ? null
    : [
        ...list.slice(0, COMPATIBILITY_CAP),
        ...(list.length > COMPATIBILITY_CAP ? [more(list.length - COMPATIBILITY_CAP)] : []),
      ]
        .join(', ')
        .replace(/, (and \d+ more|और \d+ अन्य)$/, ' $1');
}

/** The searchable compatibility text and its Hindi twin ("Make Model (Diesel, BS VI, 2020 onwards), …, and N more"). */
export function compatibilityTexts(fit: readonly BatteryFitment[]): {
  compatibility: string | null;
  compatibilityHi: string | null;
} {
  return {
    compatibility: fitText(labels(fit, false), (n) => `and ${String(n)} more`),
    compatibilityHi: fitText(labels(fit, true), (n) => `और ${String(n)} अन्य`),
  };
}
