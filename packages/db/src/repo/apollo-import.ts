import type { PlannedProduct } from '../battery-import/types';
import {
  applyBatteryImport,
  diffBatteryImport,
  type BatteryImportConfig,
  type BatteryRunResult,
} from './battery-import';
import type { Tx } from './orders';

/**
 * The Apollo tyre import (user 2026-11-24, runbook `catalogue-import.md` "Apollo tyre import"): the shared brand writer
 * in `battery-import.ts` with Apollo's brand, source tag and event. Every existing product of brand `apollo` and of brand
 * `vredestein` (sold on the Apollo shop, not imported: India only) that is not in the plan is archived; no other brand
 * is touched.
 */
export const APOLLO_IMPORT: BatteryImportConfig = {
  brand: { slug: 'apollo', name: 'Apollo' },
  alsoArchiveBrands: ['vredestein'],
  specSource: 'apollo',
  auditSource: 'apollo_import',
  event: 'admin_apollo_imported',
};

/** Read-only: what `applyApolloImport` would do (the dry run). Never writes. */
export function diffApolloImport(db: Tx, plan: readonly PlannedProduct[]): Promise<BatteryRunResult> {
  return diffBatteryImport(db, APOLLO_IMPORT, plan);
}

/** The real import: one transaction. A failure leaves the catalogue untouched. */
export function applyApolloImport(
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<BatteryRunResult> {
  return applyBatteryImport(db, APOLLO_IMPORT, plan, opts);
}
