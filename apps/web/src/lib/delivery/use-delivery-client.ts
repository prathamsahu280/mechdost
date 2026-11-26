'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { useSession } from '@/demo/session-state';
import { AUTH_MODE } from '../auth/mode';
import type { AdminDeliveryClient, AgentClient, ShopDeliveryClient } from './types';

/**
 * The delivery client for this build, loaded on demand (spec 24): the API clients with real sign-in, the browser
 * demo store otherwise. Null until the module has loaded (screens show their skeleton meanwhile). Neither module is
 * part of a page's first load, so no storefront budget changes (spec 16).
 */
const API = AUTH_MODE === 'firebase';

function useLoaded<T>(key: string, load: () => Promise<T>): T | null {
  const [state, setState] = useState<{ key: string; client: T } | null>(null);
  useEffect(() => {
    let live = true;
    void load().then((client) => {
      if (live) setState({ key, client });
    });
    return () => {
      live = false;
    };
    // `load` is rebuilt every render; `key` names everything it depends on.
  }, [key]);
  return state?.key === key ? state.client : null;
}

export function useAgentClient(): AgentClient | null {
  const locale = useLocale();
  const accountId = useSession()?.id ?? '';
  return useLoaded(`${locale}|${accountId}`, () =>
    API
      ? import('./api-clients').then((m) => m.apiAgentClient(locale))
      : import('@/demo/delivery-clients').then((m) => m.demoAgentClient(accountId, locale)),
  );
}

/** `shopSlug`: the demo shop (the API scopes the shop from the signed-in person's grants). */
export function useShopDeliveryClient(shopSlug: string): ShopDeliveryClient | null {
  const locale = useLocale();
  return useLoaded(`${locale}|${shopSlug}`, () =>
    API
      ? import('./api-clients').then((m) => m.apiShopDeliveryClient(locale))
      : import('@/demo/delivery-clients').then((m) => m.demoShopDeliveryClient(shopSlug)),
  );
}

export function useAdminDeliveryClient(): AdminDeliveryClient | null {
  const locale = useLocale();
  return useLoaded(locale, () =>
    API
      ? import('./api-clients').then((m) => m.apiAdminDeliveryClient(locale))
      : import('@/demo/delivery-clients').then((m) => m.demoAdminDeliveryClient(locale)),
  );
}

/**
 * Reload on demo changes (this tab and other tabs) and poll the API every `pollMs` while the tab is visible. The
 * caller's `reload` must be stable (useCallback).
 */
export function useLiveReload(
  client: { sample: boolean; subscribe?: (cb: () => void) => () => void } | null,
  reload: () => void,
  pollMs: number,
): void {
  useEffect(() => {
    if (!client) return;
    reload();
    if (client.subscribe) return client.subscribe(reload);
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') reload();
    }, pollMs);
    return () => {
      window.clearInterval(id);
    };
  }, [client, reload, pollMs]);
}
