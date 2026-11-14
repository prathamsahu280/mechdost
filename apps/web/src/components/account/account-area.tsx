'use client';

import { BadgeCheck, ChevronRight, MessagesSquare, Package, Pencil, Trash2, Wrench } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Suspense, useEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';
import { useCenterCurrent } from '@/lib/use-center-current';
import {
  MAX_ACCOUNT_ITEMS,
  addAddress,
  addVehicle,
  homeFor,
  removeAddress,
  removeVehicle,
  updateVehicle,
  setDefaultAddress,
  updateProfile,
  useSession,
  useSessionBlocked,
  type DemoAccount,
  type DemoVehicle,
  type Fuel,
} from '@/demo/session';
import { VEHICLE_ICON, VEHICLE_LABEL_KEY, VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import { CoinsSection } from './coins-section';
import { useTickets } from '@/demo/support';
import { SupportSection } from './support-section';
import { REQUEST_STAGES, requestStage, useHydrated, useQuotes, useRequests } from '@/demo/store';
import { useOrderRows } from '@/lib/use-order-rows';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { signOutEverywhere } from '@/lib/auth/sign-out';
import { useEmailStatus } from '@/lib/auth/use-email-status';
import { EmailPill, VerifyEmailCard } from './verify-email';
import { formatDate, formatPrice } from '@/lib/format';
import { ACCOUNT_SECTIONS, type AccountSection } from '@/lib/sections';
import { workshopNameFor } from '@/demo/i18n/localize';

const SECTION_EMOJI: Record<AccountSection, string> = {
  overview: '🏠',
  orders: '📦',
  services: '🔧',
  quotes: '💬',
  coins: '🪙',
  support: '🛟',
  vehicles: '🚗',
  addresses: '📍',
  profile: '👤',
};

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
  const blocked = useSessionBlocked();
  const prefix = usePrefix();

  if (!hydrated) return <div className="skeleton h-96 rounded-card" aria-hidden="true" />;

  if (!session) {
    return (
      <div className="space-y-8">
        <div className={`${card} flex flex-wrap items-center justify-between gap-4`}>
          <div className="max-w-xl">
            <h2 className="font-heading text-xl font-extrabold text-ink">{t('signedOutTitle')}</h2>
            {blocked ? (
              <p role="alert" className="mt-1 text-sm font-bold text-warning">
                {auth('blocked')}
              </p>
            ) : (
              <p className="mt-1 text-sm text-muted">{t('signedOutBody')}</p>
            )}
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
  const bar = useCenterCurrent<HTMLElement>(current);
  const t = useTranslations('account');
  const prefix = usePrefix();
  // What waits for the customer: a support reply to answer, a quote offer to decide (QA 2026-11-14, U4), a
  // workshop proposal to accept or an estimate to approve (spec 06).
  const session = useSession();
  const tickets = useTickets();
  const quotes = useQuotes();
  const requests = useRequests();
  const waiting: Partial<Record<AccountSection, number>> = {
    support: tickets.filter((x) => x.accountId === session?.id && x.status === 'awaiting_customer').length,
    quotes: quotes.filter((q) => q.status === 'offered').length,
    services: requests.filter(
      (x) => !x.cancellation && (requestStage(x) === 'proposed' || requestStage(x) === 'estimate_sent'),
    ).length,
  };
  return (
    <nav
      ref={bar}
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
                // `relative` keeps the badge's screen-reader text inside the link: positioned against the page, it
                // widened the page on phones (QA 2026-11-14: the support e2e clicked a moving target).
                className={`press relative flex min-h-11 items-center gap-2 rounded-pill px-4 text-sm font-bold whitespace-nowrap nav:rounded-button ${
                  active ? 'bg-accent-soft text-accent-soft-text' : 'text-ink hover:bg-pill'
                }`}
              >
                <span aria-hidden="true" className="text-[16px] leading-none">
                  {SECTION_EMOJI[s]}
                </span>
                {t(`nav_${s}`)}
                {waiting[s] ? (
                  <span className="rounded-full bg-accent-button px-1.5 text-xs font-extrabold text-white tabular-nums">
                    <span aria-hidden="true">{waiting[s]}</span>
                    <span className="sr-only">{t('navWaiting', { count: waiting[s] })}</span>
                  </span>
                ) : null}
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
  const orders = useOrderRows().rows;
  const requests = useRequests();
  const quotes = useQuotes();
  const vehicle = account.vehicles[0];
  // Real sign-in: the email's verification state from Firebase (demo accounts count as verified).
  const { state: emailState } = useEmailStatus(locale);
  const pillRef = useRef<HTMLLIElement>(null);
  const focusInCard = useRef(false);
  const lastKind = useRef(emailState.kind);
  const [emailNews, setEmailNews] = useState('');
  useEffect(() => {
    const was = lastKind.current;
    lastKind.current = emailState.kind;
    if (was !== 'unverified' || emailState.kind !== 'verified') return;
    // The card is gone. If focus was in it, put focus on the pill (its text says "verified"); otherwise say it.
    if (focusInCard.current) {
      focusInCard.current = false;
      pillRef.current?.focus();
    } else setEmailNews(t('verifyEmailDone'));
  }, [emailState.kind, t]);
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
          {AUTH_MODE === 'firebase' ? (
            <EmailPill state={emailState} email={account.email} pillRef={pillRef} />
          ) : (
            <li className="inline-flex items-center gap-1.5 rounded-pill bg-white/12 px-3 py-1.5">
              <BadgeCheck aria-hidden="true" className="size-4" />
              {t('emailVerified')} · {account.email}
            </li>
          )}
        </ul>
      </section>

      <ul className="grid grid-cols-2 gap-3 tab:grid-cols-4">
        {stats.map(([s, label, n]) => (
          <li key={s}>
            <Link
              href={`${prefix}/account/${s}`}
              className={`${card} press block p-4 hover:shadow-card-hover tab:p-5`}
            >
              <span aria-hidden="true" className="text-[22px] leading-none">
                {SECTION_EMOJI[s]}
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

      {emailState.kind === 'unverified' ? (
        <VerifyEmailCard
          email={emailState.email}
          className={card}
          onFocusInside={(inside) => {
            focusInCard.current = inside;
          }}
        />
      ) : null}
      <p role="status" className="sr-only">
        {emailNews}
      </p>
    </>
  );
}

function VehicleSummary({ vehicle }: { vehicle: DemoVehicle }) {
  const t = useTranslations('account');
  return (
    <div className="mt-2 flex items-center gap-3">
      <span
        aria-hidden="true"
        className="grid size-12 place-items-center rounded-full bg-accent-soft text-[24px]"
      >
        {VEHICLE_ICON[vehicle.type]}
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
  emoji,
  next,
  children,
}: {
  id: string;
  title: string;
  empty: string | null;
  emoji: string;
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
            className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-[24px]"
          >
            {emoji}
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
  const { rows, status } = useOrderRows();
  const orders = rows.slice(0, limit ?? 50);
  return (
    <ListSection
      id={`orders-${String(limit ?? 'all')}`}
      title={t('nav_orders')}
      empty={
        status === 'loading'
          ? o('api_loading')
          : status === 'error'
            ? o('api_error')
            : orders.length === 0
              ? t('ordersEmpty')
              : null
      }
      emoji="📦"
      next={{ href: `${prefix}/shop`, label: t('shopNow'), track: 'account_next_orders' }}
    >
      {orders.map((order) => (
        <li key={order.code}>
          <Link href={`${prefix}/orders/${order.code}`} className={row}>
            <Package aria-hidden="true" className="size-5 shrink-0 text-accent" />
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-ink">{order.code}</span>
              <span className="block text-xs text-muted">
                {formatDate(order.placedAt, locale)} ·{' '}
                {order.items === null ? '' : `${t('items', { count: order.items })} · `}
                {formatPrice(order.totalPaise)} · {o(order.statusKey)}
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
      emoji="🔧"
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
      emoji="💬"
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

type VehicleDraft = Omit<DemoVehicle, 'id'>;

/**
 * My vehicles: add, edit (user 2026-11-14: "no option to edit the already added vehicles") and remove. One form at
 * a time (calm UI): the add form, or the edit form in place of the card being edited.
 */
function Vehicles({ account }: { account: DemoAccount }) {
  const t = useTranslations('account');
  // 'add' = the add form; a vehicle id = that vehicle's edit form; null = just the list.
  const [open, setOpen] = useState<string | null>(account.vehicles.length === 0 ? 'add' : null);
  const full = account.vehicles.length >= MAX_ACCOUNT_ITEMS;

  return (
    <section aria-labelledby="vehicles-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="vehicles-title" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_vehicles')}
        </h2>
        {open === null && !full ? (
          <button
            type="button"
            onClick={() => {
              setOpen('add');
            }}
            className={primary}
          >
            + {t('addVehicle')}
          </button>
        ) : null}
      </div>
      {account.vehicles.length === 0 ? <p className="text-sm text-muted">{t('vehiclesEmpty')}</p> : null}
      <ul className="grid gap-3 tab:grid-cols-2">
        {account.vehicles.map((v) =>
          open === v.id ? (
            <li key={v.id} className="tab:col-span-2">
              <VehicleForm
                title={t('editVehicle')}
                initial={v}
                onSave={(draft) => {
                  updateVehicle(v.id, draft);
                  track('click', { id: 'vehicle_edited', path: window.location.pathname });
                  setOpen(null);
                  return true;
                }}
                onCancel={() => {
                  setOpen(null);
                }}
              />
            </li>
          ) : (
            <li key={v.id} className={`${card} flex items-start justify-between gap-3`}>
              <VehicleSummary vehicle={v} />
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(v.id);
                  }}
                  aria-label={t('editItem', { name: `${v.make} ${v.model}` })}
                  className="press inline-flex size-11 shrink-0 items-center justify-center rounded-button text-muted hover:bg-pill"
                >
                  <Pencil aria-hidden="true" className="size-5" />
                </button>
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
              </div>
            </li>
          ),
        )}
      </ul>
      {open === 'add' ? (
        <VehicleForm
          title={t('addVehicle')}
          initial={null}
          onSave={(draft) => {
            if (!addVehicle(draft)) return false;
            setOpen(null);
            return true;
          }}
          onCancel={
            account.vehicles.length > 0
              ? () => {
                  setOpen(null);
                }
              : null
          }
        />
      ) : null}
    </section>
  );
}

function VehicleForm({
  title,
  initial,
  onSave,
  onCancel,
}: {
  title: string;
  initial: DemoVehicle | null;
  /** False when the account is full (add only). */
  onSave: (draft: VehicleDraft) => boolean;
  onCancel: (() => void) | null;
}) {
  const t = useTranslations('account');
  const [error, setError] = useState<string | null>(null);
  const thisYear = new Date().getFullYear();
  const titleId = initial ? `veh-edit-${initial.id}` : 'veh-add';

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
    const ok = onSave({
      type: VEHICLE_TYPES.find((v) => v === text('type')) ?? '2W',
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
  }

  const id = (k: string) => (initial ? `veh-${initial.id}-${k}` : `veh-${k}`);
  return (
    <form noValidate aria-labelledby={titleId} onSubmit={onSubmit} className={`${card} space-y-4`}>
      <h3 id={titleId} className="font-heading text-lg font-extrabold text-ink">
        {title}
      </h3>
      <fieldset>
        <legend className="text-sm font-bold text-ink">{t('vehicleType')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {VEHICLE_TYPES.map((type, i) => (
            <label
              key={type}
              className="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text"
            >
              <input
                type="radio"
                name="type"
                value={type}
                defaultChecked={initial ? initial.type === type : i === 0}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {`${VEHICLE_ICON[type]} ${t(VEHICLE_LABEL_KEY[type])}`}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-4 tab:grid-cols-2">
        <div>
          <label htmlFor={id('make')} className="text-sm font-bold text-ink">
            {t('make')}
          </label>
          <input id={id('make')} name="make" maxLength={40} defaultValue={initial?.make} className={field} />
        </div>
        <div>
          <label htmlFor={id('model')} className="text-sm font-bold text-ink">
            {t('model')}
          </label>
          <input
            id={id('model')}
            name="model"
            maxLength={60}
            defaultValue={initial?.model}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={id('year')} className="text-sm font-bold text-ink">
            {t('year')}
          </label>
          <input
            id={id('year')}
            name="year"
            inputMode="numeric"
            maxLength={4}
            defaultValue={initial ? String(initial.year) : undefined}
            className={field}
          />
        </div>
        <div>
          <label htmlFor={id('fuel')} className="text-sm font-bold text-ink">
            {t('fuel')}
          </label>
          <select id={id('fuel')} name="fuel" defaultValue={initial?.fuel} className={field}>
            {(['petrol', 'diesel', 'cng', 'ev'] as Fuel[]).map((f) => (
              <option key={f} value={f}>
                {t(`fuel_${f}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={id('registration')} className="text-sm font-bold text-ink">
            {t('registration')}
          </label>
          <input
            id={id('registration')}
            name="registration"
            maxLength={16}
            placeholder={t('registrationHint')}
            defaultValue={initial?.registration}
            className={`${field} uppercase`}
          />
        </div>
        <div>
          <label htmlFor={id('odometer')} className="text-sm font-bold text-ink">
            {t('odometerLabel')}
          </label>
          <input
            id={id('odometer')}
            name="odometer"
            inputMode="numeric"
            maxLength={7}
            defaultValue={initial ? String(initial.odometerKm) : undefined}
            className={field}
          />
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
        {onCancel ? (
          <button type="button" onClick={onCancel} className={quiet}>
            {t('cancel')}
          </button>
        ) : null}
      </div>
    </form>
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
                  <span aria-hidden="true">📍</span>
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
        signOutEverywhere();
      }}
      className={quiet}
    >
      {t('signOut')}
    </button>
  );
}
