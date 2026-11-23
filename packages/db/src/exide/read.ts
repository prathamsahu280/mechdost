import { pictureExistsIn, readCsvFile, type CsvRow } from '../battery-import';
import { planExide, type ExidePlan } from './plan';

export { picturePath, readPicture } from '../battery-import';

/** The exidecare folder: `exide_batteries.csv`, `exide_vehicle_fitment.csv` and `pictures/…`. */
export function readExideDir(dir: string): { batteries: CsvRow[]; fitment: CsvRow[] } {
  return {
    batteries: readCsvFile(dir, 'exide_batteries.csv'),
    fitment: readCsvFile(dir, 'exide_vehicle_fitment.csv'),
  };
}

export function planExideDir(dir: string): ExidePlan {
  const { batteries, fitment } = readExideDir(dir);
  return planExide({ batteries, fitment, pictureExists: pictureExistsIn(dir) });
}
