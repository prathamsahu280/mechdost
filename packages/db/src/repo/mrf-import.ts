import type { PlannedProduct } from '../battery-import/types';
import {
  applyBatteryImport,
  diffBatteryImport,
  type BatteryImportConfig,
  type BatteryRunResult,
} from './battery-import';
import type { Tx } from './orders';

/**
 * The MRF tyre import (user 2026-11-24, runbook `catalogue-import.md` "MRF tyre import"): the shared brand writer in
 * `battery-import.ts` with MRF's brand, source tag and event. Every existing product of brand `mrf` that is not in
 * the plan is archived; other brands are never touched. The sub-categories under `tyres` are created by the writer.
 */
export const MRF_IMPORT: BatteryImportConfig = {
  brand: { slug: 'mrf', name: 'MRF' },
  specSource: 'mrf',
  auditSource: 'mrf_import',
  event: 'admin_mrf_imported',
};

/** Read-only: what `applyMrfImport` would do (the dry run). Never writes. */
export function diffMrfImport(db: Tx, plan: readonly PlannedProduct[]): Promise<BatteryRunResult> {
  return diffBatteryImport(db, MRF_IMPORT, plan);
}

/** The real import: one transaction. A failure leaves the catalogue untouched. */
export function applyMrfImport(
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<BatteryRunResult> {
  return applyBatteryImport(db, MRF_IMPORT, plan, opts);
}
