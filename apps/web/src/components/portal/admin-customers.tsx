'use client';

import dynamic from 'next/dynamic';
import {
  CUSTOMER_BLOCK_LEVELS,
  CUSTOMER_BLOCK_REASONS,
  type CustomerBlockLevel,
  type CustomerBlockReason,
} from '@mechdost/shared/customers';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import {
  blockCustomer,
  inForce,
  liftCustomerBlock,
  useCustomerBlocks,
  type DemoCustomerBlock,
} from '@/demo/customer-blocks';
import { useAccounts, type DemoAccount } from '@/demo/session';
import { AUTH_MODE } from '@/lib/auth/mode';
import { track } from '@/lib/analytics';
import { formatDate } from '@/lib/format';
import { useDisclosureFocus } from '@/lib/use-disclosure-focus';
import { maskPhone } from './admin-support';
import { portalCard, portalField, portalPrimary, portalQuiet } from './portal-guard';

const PILL: Record<CustomerBlockLevel, string> = {
  cod_only: 'bg-warning-bg text-warning',
  orders: 'bg-warning-bg text-warning',
  full: 'bg-pill text-error',
};

/** Blocks on the API (real sign-in builds only): loaded on demand so demo bundles stay the same size. */
const AdminCustomersApi = dynamic(
  () => import('./admin-customer-view-api').then((m) => m.AdminCustomersApi),
  {
    ssr: false,
  },
);

/**
 * Admin → Customers (research/admin-console.md §5, decision 2026-11-01): block a customer at one level with a
 * reason code, optional end date and a staff-only note; lift with a reason; history kept. Phone numbers are
 * masked. Same rules as the API (`/v1/admin/customers/…`): customers only, one active block per level.
 */
export function AdminCustomers({ actor }: { actor: string }) {
  return AUTH_MODE === 'firebase' ? <AdminCustomersApi /> : <DemoCustomers actor={actor} />;
}

function DemoCustomers({ actor }: { actor: string }) {
  const t = useTranslations('portal');
  const accounts = useAccounts();
  const blocks = useCustomerBlocks();
  const customers = accounts.filter((a) => a.role === 'customer');

  return (
    <section aria-labelledby="customers-title" className="space-y-4">
      <div>
        <h2 id="customers-title" className="font-heading text-xl font-extrabold text-ink">
          {t('nav_customers')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('customersLead')}</p>
      </div>
      {customers.length === 0 ? (
        <p className={`${portalCard} text-sm text-muted`}>{t('customersEmpty')}</p>
      ) : (
        <ul className="space-y-3">
          {customers.map((c) => (
            <CustomerRow
              key={c.id}
              account={c}
              blocks={blocks.filter((b) => b.accountId === c.id)}
              actor={actor}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function CustomerRow({
  account,
  blocks,
  actor,
}: {
  account: DemoAccount;
  blocks: readonly DemoCustomerBlock[];
  actor: string;
}) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const [mode, setMode] = useState<'idle' | 'block' | { lift: string }>('idle');
  const [error, setError] = useState<string | null>(null);
  const active = blocks.filter((b) => inForce(b));
  const past = blocks.filter((b) => !inForce(b));
  const idBase = `customer-${account.id}`;
  const blockKey = `${idBase}-block`;
  useDisclosureFocus(
    mode === 'block' ? blockKey : typeof mode === 'object' ? `${idBase}-lift-${mode.lift}` : null,
    blockKey,
  );

  function onBlock(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const level = data.get('level') as CustomerBlockLevel;
    const reasonCode = data.get('reason') as CustomerBlockReason;
    const ends = data.get('endsAt');
    const endsAt = typeof ends === 'string' && ends ? new Date(`${ends}T23:59:59+05:30`).toISOString() : null;
    const note = data.get('note');
    const result = blockCustomer({
      account,
      level,
      reasonCode,
      note: typeof note === 'string' ? note : '',
      endsAt,
      by: actor,
    });
    if (!result.ok) {
      setError(t(`customersErr_${result.reason}`));
      document.getElementById(`${idBase}-level`)?.focus(); // errors are about the level (e.g. already blocked)
      return;
    }
    track('admin_customer_block', { action: 'blocked', level, reasonCode });
    setMode('idle');
    setError(null);
  }

  function onLift(e: SyntheticEvent<HTMLFormElement>, block: DemoCustomerBlock) {
    e.preventDefault();
    const reason = new FormData(e.currentTarget).get('liftReason');
    const result = liftCustomerBlock(block.id, typeof reason === 'string' ? reason : '', actor);
    if (!result.ok) {
      setError(t(result.reason === 'reason' ? 'customersErr_liftReason' : `customersErr_${result.reason}`));
      document.getElementById(`${idBase}-lift`)?.focus();
      return;
    }
    track('admin_customer_block', { action: 'lifted', level: block.level });
    setMode('idle');
    setError(null);
  }

  const errorLine = error ? (
    <p id={`${idBase}-error`} role="alert" className="mt-2 text-sm font-bold text-error">
      {error}
    </p>
  ) : null;

  return (
    <li className={portalCard}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p data-user-content className="font-heading text-lg font-extrabold break-words text-ink">
            {account.name}
          </p>
          <p className="text-xs text-muted" lang="en">
            {maskPhone(`91${account.phone}`)}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {active.length === 0 ? (
            <span className="inline-flex rounded-pill bg-success-bg px-3 py-1 text-xs font-extrabold text-success">
              {t('customersClear')}
            </span>
          ) : (
            active.map((b) => (
              <span
                key={b.id}
                className={`inline-flex rounded-pill px-3 py-1 text-xs font-extrabold ${PILL[b.level]}`}
              >
                {t(`customersLevel_${b.level}`)}
              </span>
            ))
          )}
        </div>
      </div>

      {active.map((b) => (
        <div key={b.id} className="mt-3 rounded-lg bg-surface-alt px-3 py-2 text-sm">
          <p className="text-ink">
            {t(`customersEffect_${b.level}`)} · {t(`customersReason_${b.reasonCode}`)}
            {b.endsAt ? ` · ${t('customersUntil', { date: formatDate(b.endsAt, locale) })}` : ''}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            <span data-user-content>{b.by}</span> · {formatDate(b.at, locale)}
            {b.note ? (
              <>
                {' · '}
                <span data-user-content>{b.note}</span>
              </>
            ) : null}
          </p>
          {typeof mode === 'object' && mode.lift === b.id ? (
            <form
              noValidate
              onSubmit={(e) => {
                onLift(e, b);
              }}
              className="mt-2"
            >
              <label htmlFor={`${idBase}-lift`} className="text-sm font-bold text-ink">
                {t('customersLiftReason')}
              </label>
              <input
                id={`${idBase}-lift`}
                data-disclosure-field={`${idBase}-lift-${b.id}`}
                name="liftReason"
                autoComplete="off"
                maxLength={300}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? `${idBase}-error` : undefined}
                className={portalField}
              />
              {errorLine}
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="submit" className={portalPrimary}>
                  {t('customersLiftConfirm')}
                </button>
                <button
                  type="button"
                  className={portalQuiet}
                  onClick={() => {
                    setMode('idle');
                    setError(null);
                  }}
                >
                  {t('partnerCancel')}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              data-disclosure-trigger={`${idBase}-lift-${b.id}`}
              className={`${portalQuiet} mt-1`}
              onClick={() => {
                setMode({ lift: b.id });
                setError(null);
              }}
            >
              {t('customersLift')}
            </button>
          )}
        </div>
      ))}

      {mode === 'block' ? (
        <form noValidate onSubmit={onBlock} className="mt-3 grid gap-3 min-[600px]:grid-cols-2">
          <div>
            <label htmlFor={`${idBase}-level`} className="text-sm font-bold text-ink">
              {t('customersLevel')}
            </label>
            <select
              id={`${idBase}-level`}
              data-disclosure-field={blockKey}
              name="level"
              aria-describedby={error ? `${idBase}-error` : undefined}
              className={portalField}
              defaultValue="cod_only"
            >
              {CUSTOMER_BLOCK_LEVELS.map((l) => (
                <option key={l} value={l}>
                  {t(`customersLevel_${l}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idBase}-reason`} className="text-sm font-bold text-ink">
              {t('customersReason')}
            </label>
            <select id={`${idBase}-reason`} name="reason" className={portalField} defaultValue="cod_refused">
              {CUSTOMER_BLOCK_REASONS.map((r) => (
                <option key={r} value={r}>
                  {t(`customersReason_${r}`)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${idBase}-ends`} className="text-sm font-bold text-ink">
              {t('customersEndsAt')}
            </label>
            <input id={`${idBase}-ends`} name="endsAt" type="date" className={portalField} />
          </div>
          <div>
            <label htmlFor={`${idBase}-note`} className="text-sm font-bold text-ink">
              {t('customersNote')}
            </label>
            <input
              id={`${idBase}-note`}
              name="note"
              autoComplete="off"
              maxLength={500}
              className={portalField}
            />
          </div>
          <div className="min-[600px]:col-span-2">
            {errorLine}
            <div className="mt-1 flex flex-wrap gap-2">
              <button type="submit" className={portalPrimary}>
                {t('customersBlockConfirm', { name: account.name })}
              </button>
              <button
                type="button"
                className={portalQuiet}
                onClick={() => {
                  setMode('idle');
                  setError(null);
                }}
              >
                {t('partnerCancel')}
              </button>
            </div>
          </div>
        </form>
      ) : mode === 'idle' ? (
        <div className="mt-3">
          <button
            type="button"
            data-disclosure-trigger={blockKey}
            className={portalQuiet}
            onClick={() => {
              setMode('block');
              setError(null);
            }}
          >
            {t('customersBlock')}
          </button>
        </div>
      ) : null}

      {past.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-bold text-ink">
            {t('customersHistory', { count: past.length })}
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {past.map((b) => (
              <li key={b.id}>
                {t(`customersLevel_${b.level}`)} · {t(`customersReason_${b.reasonCode}`)} ·{' '}
                {formatDate(b.at, locale)}
                {b.liftedReason ? (
                  <>
                    {' → '}
                    {t('customersLifted')}: <span data-user-content>{b.liftedReason}</span>
                  </>
                ) : (
                  ` → ${t('customersEnded')}`
                )}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}
