import { pictureExistsIn, readCsvFile, type CsvRow } from '../battery-import';
import { planAmaron, type AmaronPlan } from './plan';

export { csvRows, picturePath, readPicture, type CsvRow } from '../battery-import';

/** The amaron_batteries folder: the batteries, vehicle fitment and Home UPS combos CSVs and `pictures/…`. */
export function readAmaronDir(dir: string): { batteries: CsvRow[]; fitment: CsvRow[]; combos: CsvRow[] } {
  return {
    batteries: readCsvFile(dir, 'amaron_batteries.csv'),
    fitment: readCsvFile(dir, 'amaron_vehicle_fitment.csv'),
    combos: readCsvFile(dir, 'amaron_home_ups_combos.csv'),
  };
}

export function planAmaronDir(dir: string): AmaronPlan {
  return planAmaron({ ...readAmaronDir(dir), pictureExists: pictureExistsIn(dir) });
}
