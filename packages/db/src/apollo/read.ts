import { pictureExistsIn, readCsvFile } from '../battery-import';
import { planApollo, type ApolloPlan, type ApolloPlanInput } from './plan';

export { csvRows, picturePath, readPicture, type CsvRow } from '../battery-import';

/** The apollo_tyres folder: the tyres, brochure and vehicle fitment CSVs and `pictures/…`. */
export function readApolloDir(dir: string): Pick<ApolloPlanInput, 'tyres' | 'brochure' | 'fitment'> {
  return {
    tyres: readCsvFile(dir, 'apollo_tyres.csv'),
    brochure: readCsvFile(dir, 'apollo_brochure_products.csv'),
    fitment: readCsvFile(dir, 'apollo_vehicle_fitment.csv'),
  };
}

export function planApolloDir(dir: string): ApolloPlan {
  return planApollo({ ...readApolloDir(dir), pictureExists: pictureExistsIn(dir) });
}
