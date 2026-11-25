import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { cleanSpecText, picturePath, type CsvRow } from '../battery-import';
import { hindiName } from '../tyre-import/hindi';
import { LUBE_TEXT_WORDS_HI, LUBE_WORDS_HI } from './hindi';
import type { LubeItem, LubePack, LubeText } from './types';
import { canonicalPack, gradeKey, titleLubeName } from './text';

/** Helpers both makers' adapters share (pure). */

export const txt = (row: CsvRow, column: string): string => cleanSpecText(row[column] ?? '');

/** Hindi text with the product names it quotes in the same Hindi words as the products (an all-capitals word is a name). */
export function hindiText(hi: string): string {
  return hi
    .replace(/Type A Suffix A/g, 'टाइप A सफ़िक्स A')
    .replace(/Force One/g, 'फ़ोर्स वन')
    .replace(/[A-Za-z]+/g, (run) => {
      const lower = run.toLowerCase();
      const plain = LUBE_TEXT_WORDS_HI[lower];
      if (plain !== undefined) return plain;
      const named = run.length >= 3 && run === run.toUpperCase() ? LUBE_WORDS_HI[lower] : undefined;
      return named ?? run;
    });
}

/** A source text with its Hindi: the entry of the dictionary, or an empty Hindi text and the English in `missing`. */
export function withHindi(
  en: string,
  dict: Readonly<Record<string, string>>,
  missing: Set<string>,
): LubeText | null {
  if (en === '') return null;
  const hi = dict[en];
  if (hi === undefined) missing.add(en);
  return { en, hi: hi === undefined ? '' : hindiText(hi) };
}

/** Feature lines of "A; B; C" (the pages join them with a semicolon). */
export function featureLines(text: string): string[] {
  return text
    .split(/;\s+|;$/)
    .map((f) => f.trim())
    .filter((f) => f !== '');
}

/** The display grade of a name: "10W-30", "90", "NLGI 3", or null. */
export function gradeText(name: string, category?: string): string | null {
  const nlgi = /\bNLGI (\d(?:\/\d)?)/.exec(name);
  if (nlgi) return `NLGI ${nlgi[1] ?? ''}`;
  const dot = /\bDOT (\d(?:\.\d)?)\b/.exec(name);
  if (dot) return `DOT ${dot[1] ?? ''}`;
  const key = gradeKey(name);
  if (key === '') return null;
  // A greases's lone number is its NLGI consistency grade ("HP Multipurpose Grease 3").
  if (category === 'greases' && /^\d$/.test(key)) return `NLGI ${key}`;
  const m = /^(\d{1,2}W)(\d{2,3})$/.exec(key);
  return m ? `${m[1] ?? ''}-${m[2] ?? ''}` : key;
}

export const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/\+/g, 'plus')
    .replace(/[^a-z0-9]/g, '');

/** "Name" in title case with the brand first: `MAK X` -> `BPCL MAK X`, `HYLUBE X` -> `HP Hylube X`. */
export function brandedName(raw: string, brandName: string, drop: RegExp | null): string {
  const titled = titleLubeName(raw);
  const body = drop ? titled.replace(drop, '').trim() : titled;
  return body.toLowerCase().startsWith(`${brandName.toLowerCase()} `) ? body : `${brandName} ${body}`;
}

export function hindiOfName(name: string): string {
  return hindiName(name, LUBE_WORDS_HI);
}

/** The content hash of a picture file inside the source folder (cached; null when the file cannot be read). */
export function pictureHashIn(dir: string): (file: string) => string | null {
  const cache = new Map<string, string | null>();
  return (file) => {
    if (!cache.has(file)) {
      try {
        cache.set(
          file,
          createHash('sha1')
            .update(readFileSync(picturePath(dir, file)))
            .digest('hex'),
        );
      } catch {
        cache.set(file, null);
      }
    }
    return cache.get(file) ?? null;
  };
}

/** Packs of the same size under one label: the one with a price wins; two different prices keep the first and say so. */
export function mergePacks(packs: readonly LubePack[], note: (text: string) => void): LubePack[] {
  const out = new Map<string, LubePack>();
  for (const p of packs) {
    const have = out.get(p.label);
    if (!have) out.set(p.label, p);
    else if (have.mrpPaise === null && p.mrpPaise !== null) out.set(p.label, p);
    else if (have.mrpPaise !== null && p.mrpPaise !== null && have.mrpPaise !== p.mrpPaise)
      note(
        `Pack ${p.label} is listed with two prices (${String(have.mrpPaise / 100)} and ${String(p.mrpPaise / 100)}); the first is kept.`,
      );
  }
  return [...out.values()].sort((a, b) => a.net.qty - b.net.qty);
}

/** One CSV row of the pack list as a pack, or null (with a note) when the size cannot be read. */
export function packOf(sizeText: string, price: string, note: (text: string) => void): LubePack | null {
  const canon = canonicalPack(sizeText);
  if (!canon) {
    note(`Pack size "${sizeText}" is not a volume or weight; left out.`);
    return null;
  }
  const rupees = price.trim();
  const mrpPaise = /^\d+(\.\d+)?$/.test(rupees) ? Math.round(Number(rupees) * 100) : null;
  return { label: canon.label, net: canon.net, mrpPaise, sourceText: sizeText };
}

/** Two items with the same name (a product listed under two categories): keep the richer one, fold in the packs. */
export function mergeItems(items: readonly LubeItem[]): LubeItem[] {
  const byKey = new Map<string, LubeItem>();
  for (const item of items) {
    const key = nameKey(item.name);
    const have = byKey.get(key);
    if (!have) {
      byKey.set(key, { ...item });
      continue;
    }
    const richer = item.photoFile !== null && item.draftReason === null && have.draftReason !== null;
    const base = richer ? { ...item } : have;
    const other = richer ? have : item;
    const packs = mergePacks([...base.packs, ...other.packs], (n) => base.checks.push(n));
    byKey.set(key, {
      ...base,
      sourceRows: [...new Set([...have.sourceRows, ...item.sourceRows])],
      packs,
      features: base.features.length >= other.features.length ? base.features : other.features,
      application: base.application ?? other.application,
      shortDescription: base.shortDescription ?? other.shortDescription,
      specsMet: base.specsMet !== '' ? base.specsMet : other.specsMet,
      properties: Object.keys(base.properties).length > 0 ? base.properties : other.properties,
      checks: [
        ...new Set([
          ...base.checks.filter((c) => !c.startsWith('Listed ')),
          ...other.checks.filter((c) => !c.startsWith('Listed ')),
          `Listed ${String(have.sourceRows.length + item.sourceRows.length)} times in the source (rows ${[...new Set([...have.sourceRows, ...item.sourceRows])].join(', ')}); merged into one product.`,
        ]),
      ],
    });
  }
  return [...byKey.values()];
}
