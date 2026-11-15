import { WaitlistEntryDto, WaitlistListDto } from '@mechdost/shared/waitlist';
import { authed } from './orders-api';

/**
 * "Notify me" for a PIN that is not served (spec 15 waitlist, design 2026-11-15 item 7). Signed in only: the PIN is the
 * whole request (the notice goes to the account, so there is no email or phone field to type).
 */
export const fetchWaitlist = (locale: string) => authed(locale, '/me/pincode-waitlist', WaitlistListDto);

export const joinWaitlist = (locale: string, pincode: string) =>
  authed(locale, '/me/pincode-waitlist', WaitlistEntryDto, { method: 'POST', body: { pincode } });

export const leaveWaitlist = (locale: string, pincode: string) =>
  authed(locale, `/me/pincode-waitlist/${encodeURIComponent(pincode)}`, WaitlistRemovedSchema, {
    method: 'DELETE',
  });

const WaitlistRemovedSchema = {
  safeParse: (v: unknown) =>
    typeof v === 'object' && v !== null && 'removed' in v && v.removed === true
      ? { success: true as const, data: true as const }
      : { success: false as const },
};
