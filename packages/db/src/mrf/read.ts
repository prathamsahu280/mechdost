import { pictureExistsIn, readCsvFile } from '../battery-import';
import type { TyrePlan } from '../tyre-import';
import { planMrf, type MrfPlanInput } from './plan';

export { csvRows, picturePath, readPicture, type CsvRow } from '../battery-import';

/** The mrf_tyres folder: the tyres and vehicle fitment CSVs and `pictures/…`. */
export function readMrfDir(dir: string): Pick<MrfPlanInput, 'tyres' | 'fitment'> {
  return {
    tyres: readCsvFile(dir, 'mrf_tyres.csv'),
    fitment: readCsvFile(dir, 'mrf_vehicle_fitment.csv'),
  };
}

export function planMrfDir(dir: string): TyrePlan {
  return planMrf({ ...readMrfDir(dir), pictureExists: pictureExistsIn(dir) });
}
