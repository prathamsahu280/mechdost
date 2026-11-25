import type { NetQuantity } from '@mechdost/shared/product-attributes';
import { parseNetQuantity } from '../catalogue-v2/plan';

/** Pure text helpers of the HP and BPCL MAK lubricant imports (user 2026-11-25). */

/** Words that are acronyms or codes and stay in capitals in a product name. */
const ACRONYMS: ReadonlySet<string> = new Set([
  'HP',
  'BPCL',
  'II',
  'III',
  'IID',
  'IV',
  'MP',
  'WB',
  'PCMO',
  'MAK',
  'CNG',
  'LPG',
  'ATF',
  'CVT',
  'EP',
  'XP',
  'XL',
  'HD',
  'LL',
  'LS',
  'ZFL',
  'NXT',
  'UTTO',
  'HMO',
  'DEF',
  'AUS',
  'EV',
  'KLT',
  'HDX',
  'MG',
  'KB',
  'RR',
  'HVI',
  'API',
  'NLGI',
  'DOT',
  'BTH',
  'GE',
  'HMF',
  'ACEA',
  'JASO',
  'TC',
  'SP',
  'FD',
  'TO',
  'AP',
  'DG',
  'BS',
  'VI',
  'CD',
  'CF',
  'CI',
  'CH',
  'CK',
  'CJ',
  'SL',
  'SN',
  'SM',
  'SF',
  'SJ',
]);

/** Broken bytes of the export (U+FFFD), the registered and trademark signs, en dashes and "word +" spacing. */
const CLEAN_CHANGES: readonly [RegExp, string][] = [
  [/(\d{1,2}W)�(\d{2})/gi, '$1-$2'],
  [/[�®™]/g, ''],
  [/–/g, '-'],
  [/([A-Za-z0-9])\s*\+\s*(?=[A-Za-z0-9])/g, '$1+ '],
];

const TITLE_CHANGES: readonly [RegExp, string][] = [
  [/FUTUR[ -]X/gi, 'FUTUR-X'],
  [/\bNLGI Grade:?\s*/gi, 'NLGI '],
  [/\bNO\.(\d)/gi, 'No.$1'],
];

/** Words with a digit that are names, not codes ("RACER2"). */
const NAME_TOKENS: Readonly<Record<string, string>> = { RACER2: 'Racer2' };

/** Name text without the broken bytes of the export, spaces squeezed, a grade written twice kept once. */
export function cleanLubeName(raw: string): string {
  let t = raw;
  for (const [re, to] of CLEAN_CHANGES) t = t.replace(re, to);
  t = t.replace(/\s+/g, ' ').trim();
  return t.replace(/\b(\d{1,2}W-\d{2,3})\s+\1\b/gi, '$1');
}

/**
 * Name of a lubricant in title case (user 2026-11-25: "exact names in title case"). Words with a digit and words that
 * already mix cases are kept; a word of capitals is title-cased unless it is an acronym; every SAE grade is written
 * `10W-30` however the page spells it ("10W 30", "20W40"); `NLGI Grade: 3` is written `NLGI 3`.
 */
export function titleLubeName(raw: string): string {
  let t = cleanLubeName(raw);
  for (const [re, to] of TITLE_CHANGES) t = t.replace(re, to);
  t = t.replace(/\b(\d{1,2})w[ -]?(\d{2,3})\b/gi, (_m, a: string, b: string) => `${a}W-${b}`);
  t = t.replace(/\b(\d{1,3})w\b/g, '$1W');
  const dup = /\s+API\s+([A-Z]{2}-\d)(?: PLUS)?$/i.exec(t);
  if (dup?.[1] && t.slice(0, dup.index).toUpperCase().includes(dup[1].toUpperCase()))
    t = t.slice(0, dup.index);
  return t
    .split(' ')
    .map((token) => {
      const named = NAME_TOKENS[token.toUpperCase()];
      if (named) return named;
      if (/\d/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token))) return token;
      return token.replace(/[A-Za-z]+/g, (run) =>
        ACRONYMS.has(run.toUpperCase()) || run.length === 1
          ? run.toUpperCase()
          : run.charAt(0).toUpperCase() + run.slice(1).toLowerCase(),
      );
    })
    .join(' ');
}

const UNIT = String.raw`\d{1,2}W[ -]?\d{2,3}(?:\s*\([A-Z]+\))?|\d{1,3}W?(?:\s*\([A-Z]+\))?`;
const GRADE_TOKEN = new RegExp(String.raw`(?<![\w./:-])(?:${UNIT})(?![\w/:-])`, 'gi');
const SEPARATOR = /^(?:\s*(?:,|&|and)\s*|\s+)$/i;

interface Token {
  text: string;
  start: number;
  end: number;
}

function gradeTokens(text: string): Token[] {
  return [...text.matchAll(GRADE_TOKEN)].map((m) => ({
    text: m[0],
    start: m.index,
    end: m.index + m[0].length,
  }));
}

/**
 * One name per grade (user 2026-11-25: "if the same product name has several grades, each grade is its own product"):
 * `HP RACER 10W-30, 20W-40` -> `HP RACER 10W-30`, `HP RACER 20W-40`. Grades are numbers like 10W-30, 90 or 80W joined
 * by a comma, "&", "and" or a space; a name with one grade is returned as it is.
 */
export function splitGrades(name: string): string[] {
  const tokens = gradeTokens(name);
  for (let i = 0; i < tokens.length; i += 1) {
    let j = i;
    for (;;) {
      const a = tokens[j];
      const b = tokens[j + 1];
      if (!a || !b || !SEPARATOR.test(name.slice(a.end, b.start))) break;
      j += 1;
    }
    if (j > i) {
      const run = tokens.slice(i, j + 1);
      const before = name.slice(0, run[0]?.start ?? 0);
      const after = name.slice(run[run.length - 1]?.end ?? name.length);
      return run.map((t) => `${before}${t.text}${after}`.replace(/\s+/g, ' ').trim());
    }
  }
  return [name];
}

/** The last grade of a text without spaces and hyphens ("MAK SPIROL EP 80W-90" -> "80W90"), or ''. */
export function gradeKey(text: string): string {
  const last = gradeTokens(text.replace(/�/g, '-').replace(/\s*\([A-Z0-9]+\)/g, '')).at(-1);
  return last ? last.text.replace(/[\s-]/g, '').toUpperCase() : '';
}

const trimNumber = (n: number) => String(Math.round(n * 1000) / 1000);

/** A pack size as written ("1 Litre", "900 ML", "18 Kg") as the label the shop shows and its net quantity. */
export function canonicalPack(text: string): { label: string; net: NetQuantity } | null {
  const net = parseNetQuantity(text.replace(/�/g, ''));
  if (!net || net.unit === 'piece' || net.unit === 'm') return null;
  const label =
    net.unit === 'ml'
      ? net.qty >= 1000
        ? `${trimNumber(net.qty / 1000)} L`
        : `${String(net.qty)} ml`
      : net.qty >= 1000
        ? `${trimNumber(net.qty / 1000)} kg`
        : `${String(net.qty)} g`;
  return { label, net };
}

export type OilProperties = Partial<
  Record<
    'kv100Cst' | 'kv40Cst' | 'viscosityIndex' | 'flashPointC' | 'pourPointC' | 'tbnMgKohG',
    number | string
  >
>;

interface PropertyRule {
  key: keyof OilProperties;
  min: number;
  max: number;
  /** A range ("14.5-18.0") is kept as text. */
  range: boolean;
}

const RULES: Record<string, PropertyRule> = {
  kv100Cst: { key: 'kv100Cst', min: 1.5, max: 60, range: true },
  kv40Cst: { key: 'kv40Cst', min: 5, max: 1500, range: true },
  viscosityIndex: { key: 'viscosityIndex', min: 40, max: 300, range: false },
  flashPointC: { key: 'flashPointC', min: 40, max: 350, range: false },
  pourPointC: { key: 'pourPointC', min: -70, max: 6, range: false },
  tbnMgKohG: { key: 'tbnMgKohG', min: 0, max: 40, range: false },
};

/** Which typed property a table row's name is, or null (names are written ten ways: "KV@100 °C", "Pour Point, °C, Max"). */
function propertyOf(name: string): keyof OilProperties | null {
  const n = name
    .replace(/�/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9@]/g, '');
  if (n === 'vi' || n.startsWith('viscosityindex')) return 'viscosityIndex';
  if (n.startsWith('flashpoint')) return 'flashPointC';
  if (n.startsWith('pourpoint')) return 'pourPointC';
  if (n.startsWith('tbn')) return 'tbnMgKohG';
  if (n.startsWith('ccs') || n.includes('brookfield')) return null;
  if (n.startsWith('kv') || n.startsWith('kinematicviscosity')) {
    if (n.includes('@100') || n.includes('100c')) return 'kv100Cst';
    if (n.includes('@40') || n.includes('40c')) return 'kv40Cst';
  }
  return null;
}

/**
 * Typed properties of one product's grade from the grade table rows (`Grade`, `Property`, `Value`). The rows of the
 * product's own grade are used; when none match and the table has one grade only, all rows are. A value outside what
 * the property can be (a positive pour point of 36) is not stored and is listed in `rejected`.
 */
export function propertiesOf(
  rows: readonly { Grade?: string; Property?: string; Value?: string }[],
  productGrade: string,
): { props: OilProperties; rejected: string[] } {
  const own = productGrade === '' ? [] : rows.filter((r) => gradeKey(r.Grade ?? '') === productGrade);
  const grades = new Set(rows.map((r) => (r.Grade ?? '').trim()));
  const used = own.length > 0 ? own : grades.size === 1 ? rows : [];
  const props: OilProperties = {};
  const rejected: string[] = [];
  for (const r of used) {
    const key = propertyOf(r.Property ?? '');
    if (!key || props[key] !== undefined) continue;
    const rule = RULES[key];
    const value = (r.Value ?? '').trim();
    if (!rule) continue;
    if (rule.range && /^\d+(\.\d+)?\s*-\s*\d+(\.\d+)?$/.test(value)) {
      props[key] = value.replace(/\s+/g, '');
      continue;
    }
    if (!/^-?\d+(\.\d+)?$/.test(value)) continue;
    const n = Number(value);
    if (n < rule.min || n > rule.max) rejected.push(`${key} ${value}`);
    else props[key] = n;
  }
  return { props, rejected };
}
