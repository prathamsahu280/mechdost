import type { PlannedProduct } from '../battery-import/types';
import {
  applyBatteryImport,
  diffBatteryImport,
  type BatteryImportConfig,
  type BatteryRunResult,
} from './battery-import';
import type { Tx } from './orders';

/**
 * The Amaron import (user 2026-11-23, runbook `catalogue-import.md` "Amaron import"): the shared brand writer in
 * `battery-import.ts` with Amaron's brand, source tag and event. Every existing product of brand `amaron` that is not
 * in the plan (for example the demo `car-starter-battery-45ah`) is archived; other brands are never touched.
 */
export const AMARON_IMPORT: BatteryImportConfig = {
  brand: { slug: 'amaron', name: 'Amaron' },
  specSource: 'amaron',
  auditSource: 'amaron_import',
  event: 'admin_amaron_imported',
};

/** Read-only: what `applyAmaronImport` would do (the dry run). Never writes. */
export function diffAmaronImport(db: Tx, plan: readonly PlannedProduct[]): Promise<BatteryRunResult> {
  return diffBatteryImport(db, AMARON_IMPORT, plan);
}

/** The real import: one transaction. A failure leaves the catalogue untouched. */
export function applyAmaronImport(
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<BatteryRunResult> {
  return applyBatteryImport(db, AMARON_IMPORT, plan, opts);
}
