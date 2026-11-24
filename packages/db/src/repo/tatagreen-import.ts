import type { PlannedProduct } from '../battery-import/types';
import {
  applyBatteryImport,
  diffBatteryImport,
  type BatteryImportConfig,
  type BatteryRunResult,
} from './battery-import';
import type { Tx } from './orders';

/**
 * The Tata Green import (user 2026-11-24, runbook `catalogue-import.md` "Tata Green import"): the shared brand writer in
 * `battery-import.ts` with Tata Green's brand, source tag and event. Every existing product of brand `tata-green` that
 * is not in the plan (the 15 generic ones of the old catalogue) is archived; other brands are never touched.
 */
export const TATAGREEN_IMPORT: BatteryImportConfig = {
  brand: { slug: 'tata-green', name: 'Tata Green' },
  specSource: 'tatagreen',
  auditSource: 'tatagreen_import',
  event: 'admin_tatagreen_imported',
};

/** Read-only: what `applyTataGreenImport` would do (the dry run). Never writes. */
export function diffTataGreenImport(db: Tx, plan: readonly PlannedProduct[]): Promise<BatteryRunResult> {
  return diffBatteryImport(db, TATAGREEN_IMPORT, plan);
}

/** The real import: one transaction. A failure leaves the catalogue untouched. */
export function applyTataGreenImport(
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<BatteryRunResult> {
  return applyBatteryImport(db, TATAGREEN_IMPORT, plan, opts);
}
