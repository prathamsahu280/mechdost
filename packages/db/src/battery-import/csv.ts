import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { parseCsv } from '@mechdost/shared/catalogue-import';

export type CsvRow = Record<string, string>;

/** Header + records of a CSV text (BOM dropped) as one object per row. */
export function csvRows(text: string): CsvRow[] {
  const parsed = parseCsv(text);
  if (!parsed.ok) throw new Error('The CSV is malformed');
  const [header, ...records] = parsed.records;
  if (!header) return [];
  return records.map((rec) => Object.fromEntries(header.map((h, i) => [h.trim(), (rec[i] ?? '').trim()])));
}

/** One CSV file of a source folder as rows. */
export function readCsvFile(dir: string, file: string): CsvRow[] {
  return csvRows(readFileSync(join(dir, file), 'utf8'));
}

/** A picture path from the CSV, kept inside the folder (the CSV is untrusted data). */
export function picturePath(dir: string, file: string): string {
  const root = resolve(dir);
  const full = resolve(root, file);
  if (!full.startsWith(root + sep)) throw new Error(`Picture path leaves the folder: ${file}`);
  return full;
}

/** Whether a picture of the CSV exists inside the folder (a path that leaves the folder counts as missing). */
export function pictureExistsIn(dir: string): (file: string) => boolean {
  return (file) => {
    try {
      return existsSync(picturePath(dir, file));
    } catch {
      return false;
    }
  };
}

export function readPicture(dir: string, file: string): Buffer {
  return readFileSync(picturePath(dir, file));
}
