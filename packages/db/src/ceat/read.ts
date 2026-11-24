import { pictureExistsIn, readCsvFile } from '../battery-import';
import type { TyrePlan } from '../tyre-import';
import { planCeat, type CeatPlanInput } from './plan';

export { csvRows, picturePath, readPicture, type CsvRow } from '../battery-import';

/** The ceat_tyres folder: the tyres and vehicle fitment CSVs and `pictures/…`. */
export function readCeatDir(dir: string): Pick<CeatPlanInput, 'tyres' | 'fitment'> {
  return {
    tyres: readCsvFile(dir, 'ceat_tyres.csv'),
    fitment: readCsvFile(dir, 'ceat_vehicle_fitment.csv'),
  };
}

export function planCeatDir(dir: string): TyrePlan {
  return planCeat({ ...readCeatDir(dir), pictureExists: pictureExistsIn(dir) });
}
