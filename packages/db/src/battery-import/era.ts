/**
 * Model years and eras of a vehicle in a battery fitment list (shared by the Exide and Amaron importers). A source
 * column "Model year / era (from the name)" and, for Exide only, years written inside the model text are turned into
 * `yearFrom` / `yearTo` (numbers; `yearTo` null = onwards, `yearFrom` null with `yearTo` set = "up to") and a short
 * era code. An unknown value is null, never an error.
 */
export interface BatteryFitment {
  type: string;
  make: string;
  model: string;
  /** `diesel | petrol | cng | lpg | ev | hybrid | electric_start | kick_start`; null = not stated. */
  fuel: string | null;
  /** Model years the battery fits, when known (see the file comment for how null is read). */
  yearFrom: number | null;
  yearTo: number | null;
  /** `bs2 | bs3 | bs4 | bs6 | new | old | facelift`; null = nothing known. */
  era: string | null;
}

export type EraParts = Pick<BatteryFitment, 'yearFrom' | 'yearTo' | 'era'>;

const BS_YEARS: Readonly<Record<string, [number, number | null]>> = {
  bs2: [2005, 2010],
  bs3: [2010, 2017],
  bs4: [2017, 2020],
  bs6: [2020, null],
};

const NONE: EraParts = { yearFrom: null, yearTo: null, era: null };
const Y = '((?:19|20)\\d\\d)';

/** One value of the column; `explicit` = the years were written in the text (not implied by a BS norm). */
function parseOne(raw: string): EraParts & { explicit: boolean } {
  const text = raw.trim();
  const none = { ...NONE, explicit: false };
  if (text === '') return none;
  const bs = /^BS (VI|IV|III|II)\b/i.exec(text);
  if (bs?.[1]) {
    const era = { VI: 'bs6', IV: 'bs4', III: 'bs3', II: 'bs2' }[bs[1].toUpperCase()] ?? null;
    const years = era === null ? undefined : BS_YEARS[era];
    return years ? { yearFrom: years[0], yearTo: years[1], era, explicit: false } : none;
  }
  const onwards = new RegExp(`^${Y} onwards$`, 'i').exec(text) ?? new RegExp(`^from ${Y}$`, 'i').exec(text);
  if (onwards?.[1]) return { yearFrom: Number(onwards[1]), yearTo: null, era: null, explicit: true };
  const upTo = new RegExp(`^(?:up ?to|till) ${Y}$`, 'i').exec(text);
  if (upTo?.[1]) return { yearFrom: null, yearTo: Number(upTo[1]), era: null, explicit: true };
  const range = new RegExp(`^${Y} to ${Y}$`, 'i').exec(text);
  if (range?.[1] && range[2] && Number(range[2]) >= Number(range[1]))
    return { yearFrom: Number(range[1]), yearTo: Number(range[2]), era: null, explicit: true };
  const model = new RegExp(`^${Y} model$`, 'i').exec(text);
  if (model?.[1]) return { yearFrom: Number(model[1]), yearTo: Number(model[1]), era: null, explicit: true };
  if (/^newer version/i.test(text)) return { ...none, era: 'new' };
  if (/^older version/i.test(text)) return { ...none, era: 'old' };
  if (/^facelift/i.test(text)) return { ...none, era: 'facelift' };
  return none;
}

/**
 * The column's value as years and an era code. A value may hold several parts split by ";" ("From 2024; BS VI emission
 * norm (…)", "2019 model; Newer version (…)"): years written in the text win over those a BS norm implies, and a
 * "newer" next to an "older" part cancel each other (the vehicle name lists both versions).
 */
export function parseEra(raw: string): EraParts {
  const parts = raw
    .split(';')
    .map((p) => parseOne(p))
    .filter((p) => p.yearFrom !== null || p.yearTo !== null || p.era !== null);
  if (parts.length === 0) return { ...NONE };
  const withYears =
    parts.find((p) => p.explicit) ?? parts.find((p) => p.yearFrom !== null || p.yearTo !== null);
  const eras = new Set(parts.flatMap((p) => (p.era === null ? [] : [p.era])));
  const era = eras.has('new') && eras.has('old') ? null : ([...eras][0] ?? null);
  return { yearFrom: withYears?.yearFrom ?? null, yearTo: withYears?.yearTo ?? null, era };
}

export const ERA_EN: Readonly<Record<string, string>> = {
  bs2: 'BS II',
  bs3: 'BS III',
  bs4: 'BS IV',
  bs6: 'BS VI',
  new: 'new model',
  old: 'old model',
  facelift: 'facelift',
};
export const ERA_HI: Readonly<Record<string, string>> = {
  bs2: 'BS II',
  bs3: 'BS III',
  bs4: 'BS IV',
  bs6: 'BS VI',
  new: 'नया मॉडल',
  old: 'पुराना मॉडल',
  facelift: 'फ़ेसलिफ़्ट',
};

const YEAR = Y;
const YEAR_RANGE = new RegExp(`[\\s-]*\\b${YEAR}\\s*(?:-|TO)\\s*${YEAR}\\b\\s*$`, 'i');
const YEAR_ONWARDS = new RegExp(`[\\s-]*\\b${YEAR}\\s*(?:ONW[A-Z]*|\\+)\\s*$`, 'i');
const YEAR_SINGLE = new RegExp(`[\\s-]*\\b${YEAR}\\s*$`);

/**
 * Model years written inside a vehicle model ("CRETA -2023 ONWARDS", "SCORPIO 2022"; the source cuts the text at 30
 * characters, so "ONW" and "ONWAR" also mean onwards). Returns the model without the year part. A bare year is that
 * model year only; tractor codes such as "2030DI-33HP" are not years.
 */
export function parseModelYears(raw: string): {
  model: string;
  yearFrom: number | null;
  yearTo: number | null;
} {
  const text = raw.trim();
  const clean = (m: RegExpExecArray) =>
    text
      .slice(0, m.index)
      .replace(/[\s-]+$/, '')
      .trim();
  const range = YEAR_RANGE.exec(text);
  if (range?.[1] && range[2]) {
    const from = Number(range[1]);
    const to = Number(range[2]);
    if (to >= from) return { model: clean(range), yearFrom: from, yearTo: to };
  }
  const onwards = YEAR_ONWARDS.exec(text);
  if (onwards?.[1]) return { model: clean(onwards), yearFrom: Number(onwards[1]), yearTo: null };
  const single = YEAR_SINGLE.exec(text);
  if (single?.[1] && clean(single) !== '')
    return { model: clean(single), yearFrom: Number(single[1]), yearTo: Number(single[1]) };
  return { model: text, yearFrom: null, yearTo: null };
}

/** "2023 onwards", "2019-2022", "2022", "up to 2014" and the Hindi forms ("2023 से", "2019 से 2022", "2014 तक"). */
export function yearText(e: Pick<BatteryFitment, 'yearFrom' | 'yearTo'>, hi: boolean): string | null {
  if (e.yearFrom === null) {
    if (e.yearTo === null) return null;
    return hi ? `${String(e.yearTo)} तक` : `up to ${String(e.yearTo)}`;
  }
  const from = String(e.yearFrom);
  if (e.yearTo === null) return hi ? `${from} से` : `${from} onwards`;
  if (e.yearTo === e.yearFrom) return from;
  return hi ? `${from} से ${String(e.yearTo)}` : `${from}-${String(e.yearTo)}`;
}
