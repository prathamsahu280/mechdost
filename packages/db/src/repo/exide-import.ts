import type { PlannedProduct } from '../battery-import/types';
import {
  applyBatteryImport,
  batteryPhotoStates,
  diffBatteryImport,
  type BatteryImportConfig,
  type BatteryImportCounts,
  type BatteryPhotoState,
  type BatteryRowResult,
  type BatteryRunResult,
} from './battery-import';
import type { Tx } from './orders';

/**
 * The Exide import (user 2026-11-23, runbook `catalogue-import.md` "Exide import"): the shared brand writer in
 * `battery-import.ts` with Exide's brand, source tag and event.
 */
export const EXIDE_IMPORT: BatteryImportConfig = {
  brand: { slug: 'exide', name: 'Exide' },
  specSource: 'exidecare',
  auditSource: 'exide_import',
  event: 'admin_exide_imported',
};

export type ExideCounts = BatteryImportCounts;
export type ExideRowResult = BatteryRowResult;
export type ExideRunResult = BatteryRunResult;
export type ExidePhotoState = BatteryPhotoState;

/** Read-only: what `applyExideImport` would do (the dry run). Never writes. */
export function diffExideImport(db: Tx, plan: readonly PlannedProduct[]): Promise<ExideRunResult> {
  return diffBatteryImport(db, EXIDE_IMPORT, plan);
}

/** The real import: one transaction. A failure leaves the catalogue untouched. */
export function applyExideImport(
  db: Tx,
  plan: readonly PlannedProduct[],
  opts: { staffUserId: string },
): Promise<ExideRunResult> {
  return applyBatteryImport(db, EXIDE_IMPORT, plan, opts);
}

export const exidePhotoStates = batteryPhotoStates;
