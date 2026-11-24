import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pictureExistsIn, picturePath, readCsvFile, type CsvRow } from '../battery-import';
import { planTataGreen, type TataGreenPlan } from './plan';

export { csvRows, picturePath, readPicture, type CsvRow } from '../battery-import';

/**
 * SHA-256 of the grey "picture not available" image the Tata Green site serves where a product has no photo (found on
 * three products: PREMIO 55B24L (T1), PREMIO 70D23L-BH, SwitchOn TGUPS2500; the three files are byte-identical).
 */
export const PLACEHOLDER_SHA256 = '903f555e9dc5ae2329a7da0d3df6c052056c10441cf57e72014bb0fff1d76721';

/** The tatagreen_batteries folder: the batteries and vehicle fitment CSVs and `pictures/…`. */
export function readTataGreenDir(dir: string): { batteries: CsvRow[]; fitment: CsvRow[] } {
  return {
    batteries: readCsvFile(dir, 'tatagreen_batteries.csv'),
    fitment: readCsvFile(dir, 'tatagreen_vehicle_fitment.csv'),
  };
}

/** The pictures of the CSV that are the site's placeholder (compared by content, not by name). */
export function placeholderPictures(dir: string, batteries: readonly CsvRow[]): string[] {
  const exists = pictureExistsIn(dir);
  const out: string[] = [];
  for (const b of batteries)
    for (const file of (b['Picture file'] ?? '').split(' | ').map((f) => f.trim())) {
      if (file === '' || !exists(file)) continue;
      const sha = createHash('sha256')
        .update(readFileSync(picturePath(dir, file)))
        .digest('hex');
      if (sha === PLACEHOLDER_SHA256) out.push(file);
    }
  return out;
}

export function planTataGreenDir(dir: string): TataGreenPlan {
  const rows = readTataGreenDir(dir);
  return planTataGreen({
    ...rows,
    pictureExists: pictureExistsIn(dir),
    placeholderPictures: placeholderPictures(dir, rows.batteries),
  });
}
