import { DevicesDto, DevicesSignedOutDto, type DeviceView } from '@mechdost/shared/devices';
import { authed, type ApiResult } from './orders-api';

/**
 * "Where you're signed in" on the API (spec 01 § Devices): the signed-in person's own sign-ins. Answers are validated
 * with the shared schemas. Loaded only by the real-sign-in Security screen (dynamic import), never by demo pages.
 */
export async function fetchDevices(
  locale: string,
): Promise<ApiResult<{ devices: DeviceView[]; cap: number }>> {
  return authed(locale, '/me/devices', DevicesDto);
}

export function signOutDevice(locale: string, id: string): Promise<ApiResult<{ signedOut: number }>> {
  return authed(locale, `/me/devices/${encodeURIComponent(id)}/sign-out`, DevicesSignedOutDto, {
    method: 'POST',
  });
}

export function signOutOtherDevices(locale: string): Promise<ApiResult<{ signedOut: number }>> {
  return authed(locale, '/me/devices/sign-out-others', DevicesSignedOutDto, { method: 'POST' });
}
