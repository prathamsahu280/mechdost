import {
  MySavingsDto,
  OrderSavingsDto,
  type MySavingsView,
  type OrderSavingsViewDto,
} from '@mechdost/shared/savings-api';
import type { SavingsPeriod } from '@mechdost/shared/savings';
import { authed, type ApiResult } from './orders-api';

/**
 * "Your savings" on the API (decision 2026-11-26). Loaded only by the lazy real-mode savings chunks, never by the demo
 * or first-load code.
 */
export function fetchMySavings(locale: string, period: SavingsPeriod): Promise<ApiResult<MySavingsView>> {
  return authed(locale, `/me/savings?period=${period}`, MySavingsDto);
}

export function fetchOrderSavings(locale: string, code: string): Promise<ApiResult<OrderSavingsViewDto>> {
  return authed(locale, `/me/orders/${encodeURIComponent(code)}/savings`, OrderSavingsDto);
}
