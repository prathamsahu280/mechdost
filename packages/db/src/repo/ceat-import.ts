import type { PlannedProduct } from '../battery-import/types';
import {
  applyBatteryImport,
  diffBatteryImport,
  type BatteryImportConfig,
  type BatteryRunResult,
} from './battery-import';
import type { Tx } from './orders';

/**
 * The CEAT tyre import (user 2026-11-24, runbook `catalogue-import.md` "CEAT tyre import"): the shared brand writer in
 * `battery-import.ts` with CEAT's brand, source tag and event. Every existing product of brand `ceat` that is not in
 * the plan is archived; other brands are never touched. The sub-categories under `tyres` are created by the writer.
 */
export const CEAT_IMPORT: BatteryImportConfig = {
  brand: { slug: 'ceat', name: 'CEAT' },
  specSource: 'ceat',
  auditSource: 'ceat_import',
  event: 'admin_ceat_imported',
};

/** Read-only: what `applyCeatImport` would do (the dry run). Never writes. */
export function diffCeatImport(db: Tx, plan: readonly PlannedProduct[]): Promise<BatteryRunResult> {
  return diffBatteryImport(db, CEAT_IMPORT, plan);
}

/** The real import: one transaction. A failure leaves the catalogue untouched. */
export function applyCeatImport(
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<BatteryRunResult> {
  return applyBatteryImport(db, CEAT_IMPORT, plan, opts);
}
