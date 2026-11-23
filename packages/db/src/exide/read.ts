import { existsSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { csvRows, planExide, type CsvRow, type ExidePlan } from './plan';

/** The exidecare folder: `exide_batteries.csv`, `exide_vehicle_fitment.csv` and `pictures/…`. */
export function readExideDir(dir: string): { batteries: CsvRow[]; fitment: CsvRow[] } {
  const read = (file: string) => csvRows(readFileSync(join(dir, file), 'utf8'));
  return { batteries: read('exide_batteries.csv'), fitment: read('exide_vehicle_fitment.csv') };
}

/** A picture path from the CSV, kept inside the folder (the CSV is untrusted data). */
export function picturePath(dir: string, file: string): string {
  const root = resolve(dir);
  const full = resolve(root, file);
  if (!full.startsWith(root + sep)) throw new Error(`Picture path leaves the folder: ${file}`);
  return full;
}

export function planExideDir(dir: string): ExidePlan {
  const { batteries, fitment } = readExideDir(dir);
  return planExide({
    batteries,
    fitment,
    pictureExists: (file) => {
      try {
        return existsSync(picturePath(dir, file));
      } catch {
        return false;
      }
    },
  });
}

export function readPicture(dir: string, file: string): Buffer {
  return readFileSync(picturePath(dir, file));
}
