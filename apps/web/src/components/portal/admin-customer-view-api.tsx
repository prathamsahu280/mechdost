'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useState, type SyntheticEvent } from 'react';
import type { CustomerSearchDto, CustomerViewDto } from '@mechdost/shared/admin-people-api';
import { fetchCustomer, searchCustomers } from '@/lib/admin-people-api';
import {
  CONSENT_PURPOSES,
  formatDateTimeIst,
  peopleErrorKey,
  REFUND_STATUSES,
  statusOf,
  TICKET_STATUSES,
  USER_STATUSES,
} from '@/lib/admin-people-view';
import { commonErrorKey } from '@/lib/api-error-key';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { ORDER_STATES, SERVICE_REQUEST_STATES } from '@mechdost/shared/state';
import { CustomerBlocks } from './admin-customers-api';
import { StatusBadge, adminCard } from './admin-ui';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';

const text = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');

/**
 * Admin → Customers on the API (real sign-in builds; design 2026-11-15, specs 08/13): find a customer by phone (10
 * digits), email, order / request / ticket code or the start of a name, open one, and see their profile, orders,
 * service requests, tickets, refunds, coins, consents and blocks. Phone and email are masked (last 4 digits) unless
 * the role holds `customers:read_pii`; an unmasked view is recorded in the audit log and the screen says so.
 */
export function AdminCustomersApi() {
  const t = useTranslations('adminPeople');
  const tc = useTranslations('portal');
  const locale = useLocale();
  const [result, setResult] = useState<CustomerSearchDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  async function onSearch(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const q = text(new FormData(e.currentTarget).get('q')).trim();
    setBusy(true);
    const res = await searchCustomers(locale, q);
    setBusy(false);
    if (!res.ok) {
      setResult(null);
      setError(res.code);
      document.getElementById('customer-q')?.focus();
      return;
    }
    setError(null);
    setResult(res.data);
    setOpenId(null);
    track('admin_customer_search', { kind: res.data.kind, results: res.data.results.length });
  }

  const own = error ? peopleErrorKey(error) : null;
  return (
    <section aria-labelledby="customers-title" className="space-y-4">
      <div>
        <h2 id="customers-title" className="font-heading text-xl font-extrabold text-ink">
          {tc('nav_customers')}
        </h2>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t('customer_lead')}</p>
      </div>
      <form
        onSubmit={(e) => {
          void onSearch(e);
        }}
        role="search"
        className={adminCard}
        noValidate
      >
        <label htmlFor="customer-q" className="text-sm font-bold text-ink">
          {t('customer_searchLabel')}
        </label>
        <p id="customer-q-help" className="text-xs text-muted">
          {t('customer_searchHelp')}
        </p>
        <div className="mt-1 flex flex-wrap items-end gap-2">
          <input
            id="customer-q"
            name="q"
            type="search"
            autoComplete="off"
            spellCheck={false}
            maxLength={100}
            aria-invalid={error ? true : undefined}
            aria-describedby={`customer-q-help${error ? ' customer-q-error' : ''}`}
            className={`${portalField} max-w-md`}
          />
          <button type="submit" disabled={busy} className={portalPrimary}>
            {t('customer_search')}
          </button>
        </div>
        {error ? (
          <p id="customer-q-error" role="alert" className="mt-1 text-sm font-bold text-error">
            {own ? t(own) : tc(commonErrorKey(error))}
          </p>
        ) : null}
      </form>

      {result ? (
        <div className="space-y-3">
          <p role="status" className="text-sm text-muted">
            {result.results.length === 0
              ? t('customer_none')
              : t('customer_found', { count: result.results.length })}
          </p>
          <ul className="space-y-2">
            {result.results.map((r) => (
              <li key={r.id} className={`${adminCard} flex flex-wrap items-center justify-between gap-3`}>
                <div className="min-w-0">
                  <p className="font-heading text-base font-extrabold break-words text-ink">
                    <span data-user-content>{r.name ?? t('customer_noName')}</span>
                  </p>
                  <p className="text-xs text-muted" lang="en">
                    {r.phoneMasked ?? ''} {r.emailMasked ? `· ${r.emailMasked}` : ''}
                  </p>
                  <p className="text-xs text-muted">
                    {t('customer_since', { date: formatDateTimeIst(r.createdAt, locale) })}
                  </p>
                </div>
                <button
                  type="button"
                  className={portalQuiet}
                  aria-expanded={openId === r.id}
                  data-disclosure-trigger={`customer-${r.id}`}
                  onClick={() => {
                    setOpenId(r.id);
                  }}
                >
                  {t('customer_open')}
                  <span className="sr-only" data-user-content>
                    {` ${r.name ?? ''}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {openId ? (
        <div data-panel-for={`customer-${openId}`} className="space-y-3">
          <div className="flex justify-end">
            <button
              type="button"
              data-panel-cancel={`customer-${openId}`}
              onClick={() => {
                setOpenId(null);
              }}
              className={portalQuiet}
            >
              {tc('close')}
            </button>
          </div>
          <CustomerView key={openId} id={openId} />
        </div>
      ) : null}
    </section>
  );
}

function CustomerView({ id }: { id: string }) {
  const t = useTranslations('adminPeople');
  const tc = useTranslations('portal');
  const locale = useLocale();
  const [data, setData] = useState<CustomerViewDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetchCustomer(locale, id);
    if (!res.ok) {
      setError(res.code);
      return;
    }
    setError(null);
    setData(res.data);
  }, [locale, id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error)
    return (
      <div role="alert" className={`${adminCard} flex flex-wrap items-center gap-3`}>
        <p className="text-sm font-bold text-error">
          {peopleErrorKey(error) ? t('err_noAccount') : tc(commonErrorKey(error))}
        </p>
        <button
          type="button"
          className={portalQuiet}
          onClick={() => {
            setError(null);
            void load();
          }}
        >
          {tc('api_common_retry')}
        </button>
      </div>
    );
  if (!data)
    return (
      <p role="status" className={`${adminCard} text-sm text-muted`}>
        {tc('api_common_loading')}
      </p>
    );

  const p = data.profile;
  const when = (iso: string) => formatDateTimeIst(iso, locale);
  const orderLabel = (v: string) => {
    const k = statusOf(ORDER_STATES, v);
    return k ? t(`ostatus_${k}`) : v;
  };
  const serviceLabel = (v: string) => {
    const k = statusOf(SERVICE_REQUEST_STATES, v);
    return k ? t(`sstatus_${k}`) : v;
  };
  const ticketLabel = (v: string) => {
    const k = statusOf(TICKET_STATUSES, v);
    return k ? t(`tstatus_${k}`) : v;
  };
  const refundLabel = (v: string) => {
    const k = statusOf(REFUND_STATUSES, v);
    return k ? t(`rstatus_${k}`) : v;
  };
  const userStatus = statusOf(USER_STATUSES, p.status);

  return (
    <div className="space-y-4">
      <article className={adminCard} aria-labelledby="customer-name">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 id="customer-name" className="font-heading text-lg font-extrabold break-words text-ink">
            <span data-user-content>{p.name ?? t('customer_noName')}</span>
          </h3>
          {userStatus ? (
            <StatusBadge tone={userStatus === 'active' ? 'success' : 'warning'}>
              {t(`ustatus_${userStatus}`)}
            </StatusBadge>
          ) : null}
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm min-[600px]:grid-cols-2">
          <div>
            <dt className="text-xs font-bold text-muted">{t('customer_phone')}</dt>
            <dd className="text-ink" lang="en">
              {p.phone ?? '—'}{' '}
              <span lang={locale} className="text-xs text-muted">
                {p.phoneVerified ? t('customer_verified') : t('customer_notVerified')}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-muted">{t('customer_email')}</dt>
            <dd className="break-all text-ink" lang="en">
              {p.email ?? '—'}{' '}
              <span lang={locale} className="text-xs text-muted">
                {p.emailVerified ? t('customer_verified') : t('customer_notVerified')}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-muted">{t('customer_language')}</dt>
            <dd className="text-ink">{p.language === 'hi' ? t('customer_langHi') : t('customer_langEn')}</dd>
          </div>
          <div>
            <dt className="text-xs font-bold text-muted">{t('customer_joined')}</dt>
            <dd className="text-ink">{when(p.createdAt)}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted">
          {p.masked ? t('customer_maskedNote') : t('customer_auditedNote')}
        </p>
      </article>

      <div className="grid gap-4 min-[900px]:grid-cols-2">
        <Section
          title={t('customer_orders')}
          items={data.orders}
          empty={t('customer_nothing')}
          hidden={t('customer_noAccess')}
        >
          {data.orders?.map((o) => (
            <li key={o.code} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <span lang="en" className="font-bold text-ink">
                {o.code}
              </span>
              <span className="text-muted">
                {orderLabel(o.status)} · {formatPrice(o.totalPaise)} · {when(o.at)}
              </span>
            </li>
          ))}
        </Section>
        <Section
          title={t('customer_services')}
          items={data.serviceRequests}
          empty={t('customer_nothing')}
          hidden={t('customer_noAccess')}
        >
          {data.serviceRequests?.map((r) => (
            <li key={r.code} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <span lang="en" className="font-bold text-ink">
                {r.code}
              </span>
              <span className="text-muted">
                {serviceLabel(r.status)} · {when(r.at)}
              </span>
            </li>
          ))}
        </Section>
        <Section
          title={t('customer_tickets')}
          items={data.tickets}
          empty={t('customer_nothing')}
          hidden={t('customer_noAccess')}
        >
          {data.tickets?.map((r) => (
            <li key={r.code} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <span lang="en" className="font-bold text-ink">
                {r.code}
              </span>
              <span className="text-muted">
                {ticketLabel(r.status)} · {when(r.at)}
              </span>
            </li>
          ))}
        </Section>
        <Section
          title={t('customer_refunds')}
          items={data.refunds}
          empty={t('customer_nothing')}
          hidden={t('customer_noAccess')}
        >
          {data.refunds?.map((r) => (
            <li key={r.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <span className="font-bold text-ink">{formatPrice(r.amountPaise)}</span>
              <span className="text-muted">
                {refundLabel(r.status)} · {when(r.at)}
              </span>
            </li>
          ))}
        </Section>
      </div>

      <div className="grid gap-4 min-[900px]:grid-cols-2">
        <section aria-labelledby="customer-coins" className={adminCard}>
          <h3 id="customer-coins" className="font-heading text-base font-extrabold text-ink">
            {t('customer_coins')}
          </h3>
          {data.coins ? (
            <p className="mt-2 text-sm text-ink">
              {t('customer_coinsLine', { balance: data.coins.balance, earned: data.coins.lifetimeEarned })}
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted">{t('customer_noAccess')}</p>
          )}
        </section>
        <section aria-labelledby="customer-consents" className={adminCard}>
          <h3 id="customer-consents" className="font-heading text-base font-extrabold text-ink">
            {t('customer_consents')}
          </h3>
          {data.consents.length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t('customer_nothing')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line-card">
              {data.consents.map((c) => {
                const purpose = statusOf(CONSENT_PURPOSES, c.purpose);
                return (
                  <li key={c.purpose} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
                    <span className="font-bold text-ink">
                      {purpose ? t(`purpose_${purpose}`) : c.purpose}
                    </span>
                    <span className="text-muted">
                      {c.granted ? t('customer_consentOn') : t('customer_consentOff')} · {when(c.at)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <CustomerBlocks userId={p.id} />
    </div>
  );
}

function Section({
  title,
  items,
  empty,
  hidden,
  children,
}: {
  title: string;
  items: readonly unknown[] | null;
  empty: string;
  hidden: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={adminCard}>
      <h3 id={headingId} className="font-heading text-base font-extrabold text-ink">
        {title}
      </h3>
      {items === null ? (
        <p className="mt-2 text-sm text-muted">{hidden}</p>
      ) : items.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-line-card">{children}</ul>
      )}
    </section>
  );
}
