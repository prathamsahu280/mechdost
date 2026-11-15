'use client';

import { useLocale, useTranslations } from 'next-intl';
import { lazy, Suspense, useEffect, useId, useState } from 'react';
import type { SavedAddress, SavedVehicle } from '@mechdost/shared/account-api';
import type { VehicleType } from '@mechdost/shared/vehicles';
import { fetchAddresses, fetchVehicles } from '@/lib/account-api';

const NotifyMe = lazy(() => import('./notify-me').then((m) => ({ default: m.NotifyMe })));

const select =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink';

/**
 * "Use a saved address / vehicle" for the checkout and the booking form (real sign-in; design 2026-11-15). Loaded
 * lazily and only for a signed-in customer. It renders nothing while loading, on an error or when nothing is saved
 * (calm UI: the form below works on its own). The default address is picked once, on load.
 */
export function SavedAddressPicker({ onPick }: { onPick: (address: SavedAddress | null) => void }) {
  const t = useTranslations('accountApi');
  const locale = useLocale();
  const id = useId();
  const [list, setList] = useState<SavedAddress[]>([]);
  const [chosen, setChosen] = useState('');

  useEffect(() => {
    let live = true;
    void fetchAddresses(locale).then((res) => {
      if (!live || !res.ok) return;
      setList(res.data);
      const first = res.data.find((a) => a.isDefaultShipping) ?? res.data[0];
      if (first) {
        setChosen(first.id);
        onPick(first);
      }
    });
    return () => {
      live = false;
    };
    // The default is picked once per mount; later picks are the customer's.
  }, [locale]);

  if (list.length === 0) return null;
  const picked = list.find((a) => a.id === chosen) ?? null;
  return (
    <div className="min-[600px]:col-span-2">
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {t('pickAddress')}
      </label>
      <select
        id={id}
        value={chosen}
        data-user-content
        onChange={(e) => {
          setChosen(e.currentTarget.value);
          onPick(list.find((a) => a.id === e.currentTarget.value) ?? null);
        }}
        className={select}
      >
        {list.map((a) => (
          <option key={a.id} value={a.id}>
            {`${t(`label_${a.label}`)}: ${a.line1}, ${a.pincode}`}
          </option>
        ))}
        <option value="">{t('pickAddressNew')}</option>
      </select>
      {picked && !picked.serviceable ? (
        <>
          <p className="mt-1 text-xs font-bold text-warning">{t('notServiceable')}</p>
          <Suspense fallback={null}>
            <NotifyMe pincode={picked.pincode} />
          </Suspense>
        </>
      ) : null}
    </div>
  );
}

export function SavedVehiclePicker({
  types,
  onPick,
}: {
  /** Only vehicles of these types are offered (a workshop may not service every type). */
  types: readonly VehicleType[];
  onPick: (vehicle: SavedVehicle | null) => void;
}) {
  const t = useTranslations('accountApi');
  const locale = useLocale();
  const id = useId();
  const [list, setList] = useState<SavedVehicle[]>([]);
  const [chosen, setChosen] = useState('');

  useEffect(() => {
    let live = true;
    void fetchVehicles(locale).then((res) => {
      if (live && res.ok) setList(res.data.filter((v) => types.includes(v.type)));
    });
    return () => {
      live = false;
    };
    // Loaded once per mount and locale; `types` is fixed for a workshop page.
  }, [locale]);

  if (list.length === 0) return null;
  return (
    <div>
      <label htmlFor={id} className="text-sm font-bold text-ink">
        {t('pickVehicle')}
      </label>
      <select
        id={id}
        value={chosen}
        data-user-content
        onChange={(e) => {
          setChosen(e.currentTarget.value);
          onPick(list.find((v) => v.id === e.currentTarget.value) ?? null);
        }}
        className={select}
      >
        <option value="">{t('pickVehicleNew')}</option>
        {list.map((v) => (
          <option key={v.id} value={v.id}>
            {[v.make, v.model, v.registration].filter((x) => x !== null).join(' ')}
          </option>
        ))}
      </select>
    </div>
  );
}
