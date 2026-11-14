import {
  AddressDto,
  AddressesDto,
  DeletedDto,
  ProfileDto,
  VehicleDto,
  VehiclesDto,
  type AddressCreate,
  type AddressPatch,
  type MyProfile,
  type SavedAddress,
  type SavedVehicle,
  type VehicleCreate,
  type VehiclePatch,
} from '@mechdost/shared/account-api';
import { authed, type ApiResult } from './orders-api';

/**
 * The signed-in customer's saved addresses, vehicles and profile on the API (design 2026-11-15; spec 01). Answers
 * are validated with the shared schemas; the API is the only copy (no browser copy of server data). Loaded only
 * by the real-sign-in screens and the checkout / booking pickers (dynamic imports), never by demo pages.
 */
const loc = (locale: string) => (locale === 'hi' ? 'hi' : 'en');

export async function fetchAddresses(locale: string): Promise<ApiResult<SavedAddress[]>> {
  const res = await authed(locale, `/me/addresses?locale=${loc(locale)}`, AddressesDto);
  return res.ok ? { ok: true, data: res.data.addresses } : res;
}

export function createAddress(locale: string, body: AddressCreate): Promise<ApiResult<SavedAddress>> {
  return authed(locale, `/me/addresses?locale=${loc(locale)}`, AddressDto, { method: 'POST', body });
}

export function updateAddress(
  locale: string,
  id: string,
  version: number,
  changes: Omit<AddressPatch, 'version'>,
): Promise<ApiResult<SavedAddress>> {
  return authed(locale, `/me/addresses/${id}?locale=${loc(locale)}`, AddressDto, {
    method: 'PATCH',
    body: { ...changes, version },
  });
}

export function makeDefaultAddress(
  locale: string,
  id: string,
  version: number,
): Promise<ApiResult<SavedAddress>> {
  return authed(locale, `/me/addresses/${id}/default?locale=${loc(locale)}`, AddressDto, {
    method: 'POST',
    body: { version, kind: 'shipping' },
  });
}

export function removeAddress(locale: string, id: string, version: number) {
  return authed(locale, `/me/addresses/${id}?version=${String(version)}`, DeletedDto, { method: 'DELETE' });
}

export async function fetchVehicles(locale: string): Promise<ApiResult<SavedVehicle[]>> {
  const res = await authed(locale, '/me/vehicles', VehiclesDto);
  return res.ok ? { ok: true, data: res.data.vehicles } : res;
}

export function createVehicle(locale: string, body: VehicleCreate): Promise<ApiResult<SavedVehicle>> {
  return authed(locale, '/me/vehicles', VehicleDto, { method: 'POST', body });
}

export function updateVehicle(
  locale: string,
  id: string,
  version: number,
  changes: Omit<VehiclePatch, 'version'>,
): Promise<ApiResult<SavedVehicle>> {
  return authed(locale, `/me/vehicles/${id}`, VehicleDto, { method: 'PATCH', body: { ...changes, version } });
}

export function removeVehicle(locale: string, id: string, version: number) {
  return authed(locale, `/me/vehicles/${id}?version=${String(version)}`, DeletedDto, { method: 'DELETE' });
}

export function fetchProfile(locale: string): Promise<ApiResult<MyProfile>> {
  return authed(locale, '/me', ProfileDto);
}

export function saveProfile(
  locale: string,
  version: number,
  changes: { name?: string; language?: 'en' | 'hi' },
): Promise<ApiResult<MyProfile>> {
  return authed(locale, '/me', ProfileDto, { method: 'PATCH', body: { ...changes, version } });
}
