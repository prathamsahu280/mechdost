'use client';

import { useLocale } from 'next-intl';
import { useEffect, useState } from 'react';
import { AUTH_MODE } from './auth/mode';
import { permissionsOf } from './admin-nav-permissions';

/**
 * The signed-in staff member's permissions from a live `GET /v1/me` (real sign-in only), for hiding admin sections
 * the person cannot use (SIM-B5, DC-B1). `null` while loading, on any failure and in the demo: the nav then lists
 * everything and the API refuses as before. Never an authorization check.
 */
export function useAdminPermissions(): string[] | null {
  const locale = useLocale();
  const [permissions, setPermissions] = useState<string[] | null>(null);
  useEffect(() => {
    if (AUTH_MODE !== 'firebase') return;
    let live = true;
    void import('./admin-api').then(async ({ adminApi }) => {
      const res = await adminApi(locale, '/me', {
        safeParse: (v: unknown) => ({ success: true as const, data: permissionsOf(v) }),
      });
      if (live && res.ok) setPermissions(res.data);
    });
    return () => {
      live = false;
    };
  }, [locale]);
  return permissions;
}
