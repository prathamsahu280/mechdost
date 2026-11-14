import { sql } from 'drizzle-orm';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import { settingOr } from './checkout';
import { ConflictError, NotFoundError, ValidationError } from './errors';
import type { Tx } from './orders';
import { rowsOf } from './sql-rows';

/**
 * The rules a home booking must pass (spec 06, design 2026-11-15): a saved, pinned address of the customer; a workshop
 * that opted in, whose own radius covers the pin (`ST_DWithin` on the workshop pin); every chosen service marked
 * `home_available`; and the visit fee equal to the one the customer saw (a changed fee is a 409, never a surprise).
 */
export interface HomeAddress {
  line1: string;
  line2: string | null;
  landmark: string | null;
  pincode: string;
  lat: number;
  lng: number;
}

/** The customer's own live address with a pin; anything else is 404 (foreign ids included) or 422 (no pin). */
export async function loadHomeAddress(tx: Tx, userId: string, addressId: string): Promise<HomeAddress> {
  const [a] = rowsOf<{
    line1: string;
    line2: string | null;
    landmark: string | null;
    pincode: string;
    lat: unknown;
    lng: unknown;
  }>(
    await tx.execute(sql`select line1, line2, landmark, pincode, ST_Y(location::geometry) as lat,
        ST_X(location::geometry) as lng
      from addresses where id = ${addressId} and user_id = ${userId} and deleted_at is null`),
  );
  if (!a) throw new NotFoundError('Address not found');
  if (a.lat === null || a.lng === null)
    throw new ValidationError('Pin this address on the map to book a home visit', 'ADDRESS_NOT_PINNED');
  return { ...a, lat: Number(a.lat), lng: Number(a.lng) };
}

export interface HomeWorkshopRow {
  home_service: boolean;
  home_radius_km: unknown;
  home_visit_fee_paise: unknown;
  in_radius: boolean;
}

/** Throws unless the workshop may serve this home booking; returns the fee to snapshot. */
export async function assertHomeEligible(
  tx: Tx,
  input: {
    w: HomeWorkshopRow;
    cityId: string;
    seenFeePaise: number;
    serviceCount: number;
    allHomeAvailable: boolean;
  },
): Promise<number> {
  const { w } = input;
  if (!w.home_service) throw new ValidationError('This workshop does not do home visits', 'HOME_NOT_OFFERED');
  if (!w.in_radius)
    throw new ValidationError('This workshop does not travel that far', 'WORKSHOP_OUT_OF_RADIUS');
  if (input.serviceCount === 0)
    throw new ValidationError('Pick at least one service for a home visit', 'SERVICE_REQUIRED');
  if (!input.allHomeAvailable)
    throw new ValidationError('A chosen service cannot be done at home', 'SERVICE_NOT_AT_HOME');
  const fee = Number(w.home_visit_fee_paise);
  if (fee !== input.seenFeePaise)
    throw new ConflictError('The visit fee changed; check it and book again', 'FEE_CHANGED');
  const cap = await settingOr(tx, input.cityId, {
    key: 'service.home_fee_max_paise',
    fallback: OPERATIONAL_SETTINGS['service.home_fee_max_paise'].default,
  });
  if (fee > cap)
    throw new ValidationError('This workshop’s visit fee is above the city limit', 'FEE_ABOVE_CAP');
  return fee;
}
