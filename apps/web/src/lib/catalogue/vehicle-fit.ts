import { VehicleFitDto, type VehicleFit } from '@mechdost/shared/account-api';
import { authed } from '../orders-api';

/**
 * The size of a product that fits one of the signed-in customer's saved vehicles (user 2026-11-24). Loaded on demand
 * by the size picker, real sign-in mode only; nothing when signed out, nothing saved, or the call fails (the page
 * then simply keeps its default size: a missing hint never breaks buying).
 */
export async function fetchVehicleFit(locale: string, slug: string): Promise<VehicleFit | null> {
  const res = await authed(locale, `/me/vehicles/fit?product=${encodeURIComponent(slug)}`, VehicleFitDto);
  return res.ok && res.data.fitsVariantSku ? res.data : null;
}
