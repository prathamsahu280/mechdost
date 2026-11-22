import {
  BusinessApplicationReceived,
  CategoryOptions,
  TradeProfile,
  type BusinessApplicationReceivedDto,
  type TradeProfileDto,
} from '@mechdost/shared/business-api';
import { authed, call, type ApiResult } from './orders-api';

/**
 * Business applications from the browser (audience entry design 2026-11-22): the signed-in trade application and
 * fleet enquiry, the signed-out fleet lead (Turnstile token), the customer's own trade status and the category
 * list for the form. Answers are validated with the shared schemas (hard rule 4). Real sign-in builds only: import
 * with `import()` so the demo bundle never carries it.
 */
export function submitTradeApplication(
  locale: string,
  application: Record<string, unknown>,
): Promise<ApiResult<BusinessApplicationReceivedDto>> {
  return authed(locale, '/me/trade-application', BusinessApplicationReceived, {
    method: 'POST',
    body: { application },
  });
}

export function submitFleetApplication(
  locale: string,
  application: Record<string, unknown>,
  turnstileToken: string | null,
  signedIn: boolean,
): Promise<ApiResult<BusinessApplicationReceivedDto>> {
  if (signedIn)
    return authed(locale, '/me/fleet-application', BusinessApplicationReceived, {
      method: 'POST',
      body: { application },
    });
  return call('/business-applications/fleet', BusinessApplicationReceived, {
    method: 'POST',
    body: { application, turnstileToken },
  });
}

export function fetchTradeProfile(locale: string): Promise<ApiResult<TradeProfileDto>> {
  return authed(locale, '/me/trade', TradeProfile);
}

export interface CategoryOption {
  slug: string;
  name: string;
}

/** Visible catalogue categories in the page language (public). */
export async function fetchCategoryOptions(locale: string): Promise<ApiResult<CategoryOption[]>> {
  const res = await call(`/catalogue/categories?locale=${locale === 'hi' ? 'hi' : 'en'}`, CategoryOptions);
  return res.ok ? { ok: true, data: res.data.categories.map((c) => ({ slug: c.slug, name: c.name })) } : res;
}
