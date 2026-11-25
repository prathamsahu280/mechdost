import type { PlannedProduct } from '../battery-import/types';
import {
  applyBatteryImport,
  diffBatteryImport,
  type BatteryImportConfig,
  type BatteryRunResult,
} from './battery-import';
import type { Tx } from './orders';

/**
 * The HP and BPCL MAK lubricant imports (user 2026-11-25, runbook `catalogue-import.md` "HP and BPCL MAK lubricant
 * imports"): the shared brand writer in `battery-import.ts` with each brand's slug, source tag and event. Every existing
 * product of the brand that is not in the plan is archived (never deleted); no other brand (Castrol, Gulf, ...) is touched.
 */
export const HP_IMPORT: BatteryImportConfig = {
  brand: { slug: 'hp', name: 'HP' },
  specSource: 'hp',
  // User ruling 2026-11-25: the live HP Racer4 (2 orders, shop inventory) is never archived by the import.
  keepSlugs: ['hp-racer4-20w40-900ml'],
  auditSource: 'hp_import',
  event: 'admin_hp_imported',
};

export const BPCL_IMPORT: BatteryImportConfig = {
  brand: { slug: 'bpcl-mak', name: 'BPCL MAK' },
  specSource: 'bpcl',
  auditSource: 'bpcl_import',
  event: 'admin_bpcl_imported',
};

export const SERVO_IMPORT: BatteryImportConfig = {
  brand: { slug: 'servo', name: 'Servo' },
  // Old Servo products may sit under an `iocl` brand; they are archived too when not in the plan. Nothing else is touched.
  alsoArchiveBrands: ['iocl'],
  specSource: 'servo',
  auditSource: 'servo_import',
  event: 'admin_servo_imported',
};

export const diffServoImport = (db: Tx, plan: readonly PlannedProduct[]): Promise<BatteryRunResult> =>
  diffBatteryImport(db, SERVO_IMPORT, plan);
export const applyServoImport = (
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<BatteryRunResult> => applyBatteryImport(db, SERVO_IMPORT, plan, opts);

/** Read-only: what the import would do (the dry run). Never writes. */
export const diffHpImport = (db: Tx, plan: readonly PlannedProduct[]): Promise<BatteryRunResult> =>
  diffBatteryImport(db, HP_IMPORT, plan);
export const diffBpclImport = (db: Tx, plan: readonly PlannedProduct[]): Promise<BatteryRunResult> =>
  diffBatteryImport(db, BPCL_IMPORT, plan);

/** The real import: one transaction. A failure leaves the catalogue untouched. */
export const applyHpImport = (
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<BatteryRunResult> => applyBatteryImport(db, HP_IMPORT, plan, opts);
export const applyBpclImport = (
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<BatteryRunResult> => applyBatteryImport(db, BPCL_IMPORT, plan, opts);
