'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { AdminCityList, type AdminCityDto } from '@mechdost/shared/admin-config-api';
import { adminApi } from '@/lib/admin-api';
import { portalCard, portalField } from './portal-guard';

/**
 * "All cities" or one city, for the admin screens that can hold a value per city (design 2026-11-15 item 7; spec 15).
 * Lists only the cities this staff member may set values for (`GET /admin/settings/cities`); a staff member with no
 * such city sees only "All cities", or nothing when even that is out of reach. `value` is the city code, '' = all.
 */
export function CityPicker({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (code: string) => void;
}) {
  const t = useTranslations('adminTier2');
  const locale = useLocale();
  const [cities, setCities] = useState<AdminCityDto[]>([]);
  useEffect(() => {
    let live = true;
    void adminApi(locale, '/admin/settings/cities', AdminCityList).then((res) => {
      if (live && res.ok) setCities(res.data.cities);
    });
    return () => {
      live = false;
    };
  }, [locale]);
  if (cities.length === 0) return null;
  return (
    <div className={portalCard}>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {t('city_label')}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        className={`${portalField} mt-1 w-56`}
      >
        <option value="">{t('city_all')}</option>
        {cities.map((c) => (
          <option key={c.code} value={c.code}>
            {locale === 'hi' ? (c.nameHi ?? c.name) : c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
