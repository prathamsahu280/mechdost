'use client';

import {
  BadgeCheck,
  Bike,
  Car,
  ChevronRight,
  Coins,
  House,
  LifeBuoy,
  type LucideIcon,
  MapPin,
  MessageCircle,
  MessagesSquare,
  Package,
  Trash2,
  UserRound,
  Wrench,
} from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Suspense, useState, type ReactNode, type SyntheticEvent } from 'react';
import {
  MAX_ACCOUNT_ITEMS,
  addAddress,
  addVehicle,
  homeFor,
  removeAddress,
  removeVehicle,
  setDefaultAddress,
  signOut,
  updateProfile,
  useSession,
  type DemoAccount,
  type DemoVehicle,
  type Fuel,
  type VehicleType,
} from '@/demo/session';
import { CoinsSection } from './coins-section';
import { SupportSection } from './support-section';
import { ORDER_STAGES, REQUEST_STAGES, useHydrated, useOrders, useQuotes, useRequests } from '@/demo/store';
import { formatDate, formatPrice } from '@/lib/format';
import { ACCOUNT_SECTIONS, type AccountSection } from '@/lib/sections';
import { workshopNameFor } from '@/demo/i18n/localize';

const SECTION_ICONS: Record<AccountSection, LucideIcon> = {
  overview: House,
  orders: Package,
  services: Wrench,
  quotes: MessageCircle,
  coins: Coins,
  support: LifeBuoy,
  vehicles: Car,
  addresses: MapPin,
  profile: UserRound,
};

function SectionIcon({ section, className }: { section: AccountSection; className: string }) {
  const Icon = SECTION_ICONS[section];
  return <Icon aria-hidden="true" className={`shrink-0 ${className}`} strokeWidth={2.25} />;
}

const card = 'rounded-card border border-line-card bg-surface p-5 shadow-card tab:p-6';
const field =
  'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted';
const primary =
  'press inline-flex min-h-11 items-center justify-center rounded-button bg-accent-button px-5 text-sm font-bold text-white hover:bg-accent-button-hover';
const quiet =
  'press inline-flex min-h-11 items-center justify-center rounded-button border border-input-border px-4 text-sm font-bold text-ink hover:bg-pill';
const row =
  'flex min-h-14 items-center gap-3 rounded-tile border border-line-card bg-surface p-4 shadow-card hover:bg-pill';

function usePrefix() {
  return useLocale() === 'hi' ? '/hi' : '';
}

/**
 * Customer account (spec 01): section navigation + the chosen section. Signed-out visitors get a sign-in card and
 * what was done on this device; partners and staff are pointed to their portal.
 */
export function AccountArea({ section }: { section: AccountSection }) {
  const t = useTranslations('account');
  const auth = useTranslations('auth');
  const hydrated = useHydrated();
  const session = useSession();
  const prefix = usePrefix();

  if (!hydrated) return <div className="skeleton h-96 rounded-card" aria-hidden="true" />;

  if (!session) {
    return (
      <div className="space-y-8">
        <div className={`${card} flex flex-wrap items-center justify-between gap-4`}>
          <div className="max-w-xl">
            <h2 className="font-heading text-xl font-extrabold text-ink">{t('signedOutTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{t('signedOutBody')}</p>
          </div>
          <Link
            href={`${prefix}/login?next=${encodeURIComponent(`${prefix}/account${section === 'overview' ? '' : `/${section}`}`)}`}
            className={primary}
          >
            {t('signIn')}
          </Link>
        </div>
        <section aria-labelledby="device-activity">
          <h2 id="device-activity" className="font-heading text-xl font-extrabold text-ink">
            {t('deviceActivity')}
          </h2>
          <div className="mt-4 grid gap-6 nav:grid-cols-3">
            <OrdersList limit={3} />
            <ServicesList limit={3} />
            <QuotesList limit={3} />
          </div>
        </section>
      </div>
    );
  }

  if (session.role !== 'customer') {
    return (
      <div className={card}>
        <h2 className="font-heading text-xl font-extrabold text-ink">
          {t('partnerTitle', { role: auth(`role_${session.role}`) })}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('partnerBody')}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link href={`${prefix}${homeFor(session.role)}`} className={primary}>
            {t('openPortal')}
          </Link>
          <SignOutButton />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 nav:grid-cols-[220px_minmax(0,1fr)] nav:items-start">
      <SectionNav current={section} />
      <div className="min-w-0 space-y-6">
        {section === 'overview' ? <Overview account={session} /> : null}
        {section === 'orders' ? <OrdersList /> : null}
        {section === 'services' ? <ServicesList /> : null}
        {section === 'quotes' ? <QuotesList /> : null}
        {section === 'coins' ? <CoinsSection account={session} /> : null}
        {section === 'support' ? (
          // useSearchParams (preset order) needs a Suspense boundary on statically built pages.
          <Suspense fallback={null}>
            <SupportSection account={session} />
          </Suspense>
        ) : null}
        {section === 'vehicles' ? <Vehicles account={session} /> : null}
        {section === 'addresses' ? <Addresses account={session} /> : null}
        {section === 'profile' ? <Profile account={session} /> : null}
        <p className="text-xs text-muted">{t('demoNote')}</p>
      </div>
    </div>
  );
}

function SectionNav({ current }: { current: AccountSection }) {
  const t = useTranslations('account');
  const prefix = usePrefix();
  return (
    <nav
      aria-label={t('navLabel')}
      className="-mx-[5%] overflow-x-auto px-[5%] nav:sticky nav:top-28 nav:mx-0 nav:px-0"
    >
      <ul className="flex gap-2 nav:flex-col nav:gap-1">
        {ACCOUNT_SECTIONS.map((s) => {
          const active = s === current;
          return (
            <li key={s}>
              <Link
                href={`${prefix}/account${s === 'overview' ? '' : `/${s}`}`}
                aria-current={active ? 'page' : undefined}
                className={`press flex min-h-11 items-center gap-2 rounded-pill px-4 text-sm font-bold whitespace-nowrap nav:rounded-button ${
                  active ? 'bg-accent-soft text-accent-soft-text' : 'text-ink hover:bg-pill'
                }`}
              >
                <SectionIcon section={s} className="size-4" />
                {t(`nav_${s}`)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

function Overview({ account }: { account: DemoAccount }) {
  const t = useTranslations('account');
  const locale = useLocale();
  const prefix = usePrefix();
  const orders = useOrders();
  const requests = useRequests();
  const quotes = useQuotes();
  const vehicle = account.vehicles[0];
  const stats: [AccountSection, string, number][] = [
    ['orders', t('stat_orders'), orders.length],
    ['services', t('stat_services'), requests.length],
    ['quotes', t('stat_quotes'), quotes.length],
    ['vehicles', t('stat_vehicles'), account.vehicles.length],
  ];

  return (
    <>
      <section className="blueprint overflow-hidden rounded-card p-6 text-white shadow-card tab:p-8">
        <div className="flex flex-wrap items-center gap-4">
          <span
            aria-hidden="true"
            className="grid size-14 place-items-center rounded-full bg-accent-button font-heading text-2xl font-extrabold"
          >
            {account.name.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h2 className="font-heading text-2xl font-extrabold">{t('hello', { name: account.name })}</h2>
            <p className="mt-0.5 text-sm text-white/80">
              {t('memberSince', { date: formatDate(account.createdAt, locale) })}
            </p>
          </div>
        </div>
        <ul className="mt-5 flex flex-wrap gap-2 text-xs font-bold">
          <li className="inline-flex items-center gap-1.5 rounded-pill bg-white/12 px-3 py-1.5">
            <BadgeCheck aria-hidden="true" className="size-4" />
            {t('phoneVerified')} · +91 {account.phone}
          </li>
          <li className="inline-flex items-center gap-1.5 rounded-pill bg-white/12 px-3 py-1.5">
            <BadgeCheck aria-hidden="true" className="size-4" />
            {t('emailVerified')} · {account.email}
          </li>
        </ul>
      </section>

      <ul className="grid grid-cols-2 gap-3 tab:grid-cols-4">
        {stats.map(([s, label, n]) => (
          <li key={s}>
            <Link
              href={`${prefix}/account/${s}`}
              className={`${card} press block p-4 hover:shadow-card-hover tab:p-5`}
            >
              <span
                aria-hidden="true"
                className="grid size-10 place-items-center rounded-xl bg-accent-soft text-accent-soft-text"
              >
                <SectionIcon section={s} className="size-5" />
              </span>
              <span className="mt-2 block font-heading text-3xl font-extrabold text-ink tabular-nums">
                {n}
              </span>
              <span className="block text-sm text-muted">{label}</span>
            </Link>
          </li>
        ))}
      </ul>

      {vehicle ? (
        <section aria-labelledby="primary-vehicle" className={card}>
          <h2 id="primary-vehicle" className="text-sm font-bold text-muted">
            {t('primaryVehicle')}
          </h2>
          <VehicleSummary vehicle={vehicle} />
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={`${prefix}/workshops`} className={primary}>
              {t('findWorkshop')}
            </Link>
            <Link href={`${prefix}/shop`} className={quiet}>
              {t('shopParts')}
            </Link>
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 nav:grid-cols-2">
        <OrdersList limit={3} />
        <ServicesList limit={3} />
      </div>
    </>
  );
}

function VehicleSummary({ vehicle }: { vehicle: DemoVehicle }) {
  const t = useTranslations('account');
  return (
    <div className="mt-2 flex items-center gap-3">
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-soft-text"
      >
        {vehicle.type === '2W' ? (
          <Bike className="size-6" strokeWidth={2} />
        ) : (
          <Car className="size-6" strokeWidth={2} />
        )}
      </span>
      <div className="min-w-0">
        <p data-user-content className="font-heading text-lg font-extrabold text-ink">
          {vehicle.make} {vehicle.model}
        </p>
        <p className="text-sm text-muted">
          {vehicle.year} · {t(`fuel_${vehicle.fuel}`)}
          {vehicle.registration ? ` · ${vehicle.registration}` : ''} ·{' '}
          {t('odometer', { km: vehicle.odometerKm.toLocaleString('en-IN') })}
        </p>
      </div>
    </div>
  );
}

function ListSection({
  id,
  title,
  empty,
  icon: Icon,
  next,
  children,
}: {
  id: string;
  title: string;
  empty: string | null;
  icon: LucideIcon;
  next: { href: string; label: string; track: string };
  children: ReactNode;
}) {
  // Empty state = one friendly line plus its single next action (design-system UX rules). Once the list has items,
  // the same action moves to the heading row.
  return (
    <section aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id={id} className="font-heading text-xl font-extrabold text-ink">
          {title}
        </h2>
        {empty ? null : (
          <Link href={next.href} data-track={next.track} className={quiet}>
            {next.label}
          </Link>
        )}
      </div>
      {empty ? (
        <div className="mt-3 flex items-center gap-4 rounded-card border border-dashed border-line-card bg-surface p-5">
          <span
            aria-hidden="true"
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-soft-text"
          >
            <Icon className="size-6" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-muted">{empty}</p>
            <Link
              href={next.href}
              data-track={next.track}
              className="inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline-offset-4 hover:underline"
            >
              {next.label}
              <span aria-hidden="true">&nbsp;→</span>
            </Link>
          </div>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">{children}</ul>
      )}
    </section>
  );
}

function OrdersList({ limit }: { limit?: number }) {
  const t = useTranslations('account');
  const o = useTranslations('order');
  const locale = useLocale();
  const prefix = usePrefix();
  const orders = useOrders().slice(0, limit ?? 50);
  return (
    <ListSection
      id={`orders-${String(limit ?? 'all')}`}
      title={t('nav_orders')}
      empty={orders.length === 0 ? t('ordersEmpty') : null}
      icon={Package}
      next={{ href: `${prefix}/shop`, label: t('shopNow'), track: 'account_next_orders' }}
    >
      {orders.map((order) => (
        <li key={order.code}>
          <Link href={`${prefix}/orders/${order.code}`} className={row}>
            <Package aria-hidden="true" className="size-5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">{order.code}</span>
              <span className="block text-xs text-muted">
                {formatDate(order.createdAt, locale)} · {t('items', { count: order.lines.length })} ·{' '}
                {formatPrice(order.totalPaise)} · {o(`stage_${ORDER_STAGES[order.stage] ?? 'placed'}`)}
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 text-muted" />
          </Link>
        </li>
      ))}
    </ListSection>
  );
}

function ServicesList({ limit }: { limit?: number }) {
  const t = useTranslations('account');
  const r = useTranslations('request');
  const locale = useLocale();
  const prefix = usePrefix();
  const requests = useRequests().slice(0, limit ?? 50);
  return (
    <ListSection
      id={`services-${String(limit ?? 'all')}`}
      title={t('nav_services')}
      empty={requests.length === 0 ? t('servicesEmpty') : null}
      icon={Wrench}
      next={{ href: `${prefix}/workshops`, label: t('bookService'), track: 'account_next_services' }}
    >
      {requests.map((req) => (
        <li key={req.code}>
          <Link href={`${prefix}/service/${req.code}`} className={row}>
            <Wrench aria-hidden="true" className="size-5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">{req.code}</span>
              <span className="block text-xs text-muted">
                {workshopNameFor(req.workshopSlug, req.workshopName, locale)} ·{' '}
                {r(`stage_${REQUEST_STAGES[req.stage] ?? 'requested'}`)}
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 text-muted" />
          </Link>
        </li>
      ))}
    </ListSection>
  );
}

function QuotesList({ limit }: { limit?: number }) {
  const t = useTranslations('account');
  const q = useTranslations('quote');
  const locale = useLocale();
  const prefix = usePrefix();
  const quotes = useQuotes().slice(0, limit ?? 50);
  return (
    <ListSection
      id={`quotes-${String(limit ?? 'all')}`}
      title={t('nav_quotes')}
      empty={quotes.length === 0 ? t('quotesEmpty') : null}
      icon={MessageCircle}
      next={{ href: `${prefix}/quotes/new`, label: t('newQuote'), track: 'account_next_quotes' }}
    >
      {quotes.map((quote) => (
        <li key={quote.code}>
          <Link href={`${prefix}/quotes/${quote.code}`} className={row}>
            <MessagesSquare aria-hidden="true" className="size-5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">{quote.code}</span>
              <span className="block text-xs text-muted">
                {formatDate(quote.createdAt, locale)} · {q(`status_${quote.status}`)}
              </span>
            </span>
            <ChevronRight aria-hidden="true" className="size-4 text-muted" />
          </Link>
        </li>
      ))}
    </ListSection>
  );
}

function Vehicles({ account }: { account: DemoAccount }) {
  const t = useTranslations('account');
  const [adding, setAdding] = useState(account.vehicles.length === 0);
  const [error, setError] = useState<string | null>(null);
  const thisYear = new Date().getFullYear();
  const full = account.vehicles.length >= MAX_ACCOUNT_ITEMS;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const year = Number(text('year'));
    if (text('make').length < 2 || text('model').length < 1 || !(year >= 1990 && year <= thisYear + 1)) {
      setError(t('errVehicle', { year: thisYear + 1 }));
      return;
    }
    const ok = addVehicle({
      type: text('type') === '4W' ? '4W' : '2W',
      make: text('make').slice(0, 40),
      model: text('model').slice(0, 60),
      year,
      fuel: (['petrol', 'diesel', 'cng', 'ev'] as const).find((f) => f === text('fuel')) ?? 'petrol',
      registration: text('registration').toUpperCase().slice(0, 16),
      odometerKm: Math.max(0, Math.min(999_999, Math.floor(Number(text('odometer')) || 0))),
    });
    if (!ok) {
      setError(t('limit', { max: MAX_ACCOUNT_ITEMS }));
      return;
    }
    setError(null);
    setAdding(false);
  }

  return (
    <section aria-labelledby="vehicles-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="vehicles-title" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_vehicles')}
        </h2>
        {!adding && !full ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
            }}
            className={primary}
          >
            + {t('addVehicle')}
          </button>
        ) : null}
      </div>
      {account.vehicles.length === 0 ? <p className="text-sm text-muted">{t('vehiclesEmpty')}</p> : null}
      <ul className="grid gap-3 tab:grid-cols-2">
        {account.vehicles.map((v) => (
          <li key={v.id} className={`${card} flex items-start justify-between gap-3`}>
            <VehicleSummary vehicle={v} />
            <button
              type="button"
              onClick={() => {
                removeVehicle(v.id);
              }}
              aria-label={t('remove', { name: `${v.make} ${v.model}` })}
              className="press inline-flex size-11 shrink-0 items-center justify-center rounded-button text-muted hover:bg-pill"
            >
              <Trash2 aria-hidden="true" className="size-5" />
            </button>
          </li>
        ))}
      </ul>
      {adding ? (
        <form noValidate onSubmit={onSubmit} className={`${card} space-y-4`}>
          <h3 className="font-heading text-lg font-extrabold text-ink">{t('addVehicle')}</h3>
          <fieldset>
            <legend className="text-sm font-bold text-ink">{t('vehicleType')}</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              {(['2W', '4W'] as VehicleType[]).map((type, i) => (
                <label
                  key={type}
                  className="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text"
                >
                  <input
                    type="radio"
                    name="type"
                    value={type}
                    defaultChecked={i === 0}
                    className="size-5 accent-[var(--color-accent-button)]"
                  />
                  {type === '2W' ? (
                    <Bike aria-hidden="true" className="size-4 text-muted" />
                  ) : (
                    <Car aria-hidden="true" className="size-4 text-muted" />
                  )}
                  {type === '2W' ? t('twoWheeler') : t('fourWheeler')}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="grid gap-4 tab:grid-cols-2">
            <div>
              <label htmlFor="veh-make" className="text-sm font-bold text-ink">
                {t('make')}
              </label>
              <input id="veh-make" name="make" maxLength={40} className={field} />
            </div>
            <div>
              <label htmlFor="veh-model" className="text-sm font-bold text-ink">
                {t('model')}
              </label>
              <input id="veh-model" name="model" maxLength={60} className={field} />
            </div>
            <div>
              <label htmlFor="veh-year" className="text-sm font-bold text-ink">
                {t('year')}
              </label>
              <input id="veh-year" name="year" inputMode="numeric" maxLength={4} className={field} />
            </div>
            <div>
              <label htmlFor="veh-fuel" className="text-sm font-bold text-ink">
                {t('fuel')}
              </label>
              <select id="veh-fuel" name="fuel" className={field}>
                {(['petrol', 'diesel', 'cng', 'ev'] as Fuel[]).map((f) => (
                  <option key={f} value={f}>
                    {t(`fuel_${f}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="veh-registration" className="text-sm font-bold text-ink">
                {t('registration')}
              </label>
              <input
                id="veh-registration"
                name="registration"
                maxLength={16}
                placeholder={t('registrationHint')}
                className={`${field} uppercase`}
              />
            </div>
            <div>
              <label htmlFor="veh-odometer" className="text-sm font-bold text-ink">
                {t('odometerLabel')}
              </label>
              <input id="veh-odometer" name="odometer" inputMode="numeric" maxLength={7} className={field} />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm font-bold text-error">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={primary}>
              {t('save')}
            </button>
            {account.vehicles.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
                className={quiet}
              >
                {t('cancel')}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Addresses({ account }: { account: DemoAccount }) {
  const t = useTranslations('account');
  const city = useTranslations('cities');
  const [adding, setAdding] = useState(account.addresses.length === 0);
  const [error, setError] = useState<string | null>(null);
  const full = account.addresses.length >= MAX_ACCOUNT_ITEMS;

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    if (text('line1').length < 5 || !/^[1-9]\d{5}$/.test(text('pincode'))) {
      setError(t('errAddress'));
      return;
    }
    const ok = addAddress({
      // Empty = the default label, shown translated ("Home" / "घर"); a typed label is shown as typed.
      label: text('label').slice(0, 30),
      line1: text('line1').slice(0, 200),
      landmark: text('landmark').slice(0, 100),
      pincode: text('pincode'),
    });
    if (!ok) {
      setError(t('limit', { max: MAX_ACCOUNT_ITEMS }));
      return;
    }
    setError(null);
    setAdding(false);
  }

  return (
    <section aria-labelledby="addresses-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="addresses-title" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_addresses')}
        </h2>
        {!adding && !full ? (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
            }}
            className={primary}
          >
            + {t('addAddress')}
          </button>
        ) : null}
      </div>
      {account.addresses.length === 0 ? <p className="text-sm text-muted">{t('addressesEmpty')}</p> : null}
      <ul className="grid gap-3 tab:grid-cols-2">
        {account.addresses.map((a) => (
          <li key={a.id} className={card}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 font-heading font-extrabold text-ink">
                  <MapPin aria-hidden="true" className="size-4 text-accent-soft-text" />
                  {a.label ? <span data-user-content>{a.label}</span> : t('labelDefault')}
                  {a.isDefault ? (
                    <span className="rounded-pill bg-success-bg px-2 py-0.5 text-[11px] font-extrabold text-success">
                      {t('default')}
                    </span>
                  ) : null}
                </p>
                <p data-user-content className="mt-1 text-sm text-ink">
                  {a.line1}
                </p>
                {a.landmark ? (
                  <p data-user-content className="text-sm text-muted">
                    {a.landmark}
                  </p>
                ) : null}
                <p className="text-sm text-muted">
                  {city('raipur')} {a.pincode}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  removeAddress(a.id);
                }}
                aria-label={t('remove', { name: a.label || t('labelDefault') })}
                className="press inline-flex size-11 shrink-0 items-center justify-center rounded-button text-muted hover:bg-pill"
              >
                <Trash2 aria-hidden="true" className="size-5" />
              </button>
            </div>
            {!a.isDefault ? (
              <button
                type="button"
                onClick={() => {
                  setDefaultAddress(a.id);
                }}
                className={`${quiet} mt-3`}
              >
                {t('makeDefault')}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {adding ? (
        <form noValidate onSubmit={onSubmit} className={`${card} space-y-4`}>
          <h3 className="font-heading text-lg font-extrabold text-ink">{t('addAddress')}</h3>
          <div className="grid gap-4 tab:grid-cols-2">
            <div>
              <label htmlFor="addr-label" className="text-sm font-bold text-ink">
                {t('label')}
              </label>
              <input
                id="addr-label"
                name="label"
                maxLength={30}
                placeholder={t('labelHint')}
                className={field}
              />
            </div>
            <div>
              <label htmlFor="addr-pincode" className="text-sm font-bold text-ink">
                {t('pincode')}
              </label>
              <input
                id="addr-pincode"
                name="pincode"
                inputMode="numeric"
                autoComplete="postal-code"
                maxLength={6}
                className={field}
              />
            </div>
            <div className="tab:col-span-2">
              <label htmlFor="addr-line1" className="text-sm font-bold text-ink">
                {t('line1')}
              </label>
              <input
                id="addr-line1"
                name="line1"
                autoComplete="street-address"
                maxLength={200}
                className={field}
              />
            </div>
            <div className="tab:col-span-2">
              <label htmlFor="addr-landmark" className="text-sm font-bold text-ink">
                {t('landmark')}
              </label>
              <input id="addr-landmark" name="landmark" maxLength={100} className={field} />
            </div>
          </div>
          {error ? (
            <p role="alert" className="text-sm font-bold text-error">
              {error}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={primary}>
              {t('save')}
            </button>
            {account.addresses.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setAdding(false);
                  setError(null);
                }}
                className={quiet}
              >
                {t('cancel')}
              </button>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}

function Profile({ account }: { account: DemoAccount }) {
  const t = useTranslations('account');
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const text = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    if (text('name').length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text('email'))) {
      setStatus('error');
      return;
    }
    updateProfile({ name: text('name').slice(0, 100), email: text('email').toLowerCase().slice(0, 200) });
    setStatus('saved');
  }

  return (
    <section aria-labelledby="profile-title" className="space-y-4">
      <h2 id="profile-title" className="font-heading text-xl font-extrabold text-ink">
        {t('profileTitle')}
      </h2>
      <form noValidate onSubmit={onSubmit} className={`${card} max-w-xl space-y-4`}>
        <div>
          <label htmlFor="profile-name" className="text-sm font-bold text-ink">
            {t('name')}
          </label>
          <input
            id="profile-name"
            name="name"
            autoComplete="name"
            defaultValue={account.name}
            maxLength={100}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="profile-email" className="text-sm font-bold text-ink">
            {t('email')}
          </label>
          <input
            id="profile-email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={account.email}
            maxLength={200}
            className={field}
          />
        </div>
        <div>
          <label htmlFor="profile-phone" className="text-sm font-bold text-ink">
            {t('phone')}
          </label>
          <input
            id="profile-phone"
            readOnly
            value={`+91 ${account.phone}`}
            className={`${field} bg-surface-alt`}
          />
          <p className="mt-1 text-xs text-muted">{t('phoneNote')}</p>
        </div>
        <p
          role="status"
          className={`text-sm font-bold ${status === 'error' ? 'text-error' : 'text-success'}`}
        >
          {status === 'saved' ? t('saved') : status === 'error' ? t('errProfile') : ''}
        </p>
        <div className="flex flex-wrap gap-3">
          <button type="submit" className={primary}>
            {t('save')}
          </button>
          <SignOutButton />
        </div>
      </form>
    </section>
  );
}

function SignOutButton() {
  const t = useTranslations('account');
  return (
    <button
      type="button"
      onClick={() => {
        signOut();
      }}
      className={quiet}
    >
      {t('signOut')}
    </button>
  );
}
