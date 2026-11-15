'use client';

import type { ShopCsvPreviewDto } from '@mechdost/shared/shop-tools';
import { SHOP_CSV_MAX_ROWS } from '@mechdost/shared/shop-csv';
import { useLocale, useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { track } from '@/lib/analytics';
import { formatPrice } from '@/lib/format';
import { applyCsv, downloadTemplate, previewCsv } from '@/lib/shop-tools-api';
import { csvFileKey, csvProblemKey } from '@/lib/shop-tools-view';
import { portalCard, portalPrimary, portalQuiet } from './portal-guard';
import { FlashNote, useFlash } from './shop-flash';

type Step =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'checked'; file: File; preview: ShopCsvPreviewDto }
  | { kind: 'applying'; file: File; preview: ShopCsvPreviewDto };

const ERRORS_SHOWN = 20;
const CHANGES_SHOWN = 15;

/**
 * "Update stock with a file" (design 2026-11-15, item 4; spec 07). Choose a file, check it (what changes, which lines
 * have problems), then apply: the API applies every change in one transaction or none. A price in the file is only a
 * price request. One primary action at a time: Check, then Apply. The check is repeated on the server when applying, so
 * what was previewed is never trusted. Real API mode only; own module (JS budget).
 */
export function ShopCsvCard({ shopId }: { shopId: string }) {
  const t = useTranslations('shopTier2');
  const locale = useLocale();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [name, setName] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { flash, show } = useFlash();
  const id = `shop-csv-${shopId}`;

  function reset() {
    setStep({ kind: 'idle' });
    setFile(null);
    setName(null);
    setError(null);
    if (input.current) input.current.value = '';
  }

  async function onTemplate() {
    setError(null);
    const r = await downloadTemplate(locale, shopId);
    track('click', { id: 'shop_csv_template', path: window.location.pathname });
    if (!r.ok) setError(r.code);
  }

  async function onCheck() {
    if (!file) return;
    setError(null);
    setStep({ kind: 'checking' });
    const r = await previewCsv(locale, shopId, file);
    track('click', { id: 'shop_csv_check', path: window.location.pathname });
    if (!r.ok) {
      setStep({ kind: 'idle' });
      setError(r.code);
      return;
    }
    setStep({ kind: 'checked', file, preview: r.data });
  }

  async function onApply() {
    if (step.kind !== 'checked') return;
    const { file: f, preview } = step;
    setError(null);
    setStep({ kind: 'applying', file: f, preview });
    const r = await applyCsv(locale, shopId, f);
    track('click', { id: 'shop_csv_apply', path: window.location.pathname });
    if (!r.ok) {
      setStep({ kind: 'checked', file: f, preview });
      setError(r.code);
      return;
    }
    reset();
    show({
      tone: 'ok',
      text: t('csvApplied', { stock: r.data.stock, active: r.data.active, prices: r.data.priceRequests }),
    });
  }

  const preview = step.kind === 'checked' || step.kind === 'applying' ? step.preview : null;
  const working = step.kind === 'checking' || step.kind === 'applying';
  const clean = preview !== null && preview.errors.length === 0;
  const hasChanges = preview !== null && preview.changes.length > 0;

  return (
    <section aria-labelledby={`${id}-title`} id="shop-csv" className={portalCard}>
      <h3 id={`${id}-title`} className="font-heading text-lg font-extrabold text-ink">
        {t('csvTitle')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('csvLead')}</p>
      <p className="mt-1 text-xs text-muted">{t('csvRules', { rows: SHOP_CSV_MAX_ROWS })}</p>
      <FlashNote flash={flash} />

      <div className="mt-3 flex flex-wrap items-center gap-2" aria-busy={working || undefined}>
        <button type="button" onClick={() => void onTemplate()} className={portalQuiet}>
          {t('csvTemplate')}
        </button>
        <label className={`file-pick ${portalQuiet} cursor-pointer`}>
          {t('csvChoose')}
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={working}
            onChange={(e) => {
              const picked = e.target.files?.[0] ?? null;
              setFile(picked);
              setName(picked ? picked.name : null);
              setStep({ kind: 'idle' });
              setError(null);
            }}
          />
        </label>
        {name ? (
          <span className="min-w-0 truncate text-sm text-ink" data-user-content>
            {t('csvChosen', { name })}
          </span>
        ) : null}
      </div>

      {file && !preview ? (
        <button
          type="button"
          disabled={working}
          onClick={() => void onCheck()}
          className={`${portalPrimary} mt-3`}
        >
          {step.kind === 'checking' ? t('csvChecking') : t('csvCheck')}
        </button>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-sm font-bold text-error">
          {t(csvFileKey(error), { rows: SHOP_CSV_MAX_ROWS })}
        </p>
      ) : null}

      {preview ? (
        <div className="mt-4 space-y-3">
          <p role="status" className="text-sm text-ink">
            {t('csvSummary', {
              rows: preview.rows,
              stock: preview.counts.stock,
              active: preview.counts.active,
              prices: preview.counts.priceRequests,
              unchanged: preview.unchanged,
            })}
          </p>

          {preview.errors.length > 0 ? (
            <div role="alert" className="rounded-lg bg-error-bg p-3 text-sm text-error">
              <p className="font-extrabold">{t('csvErrorsTitle', { count: preview.errors.length })}</p>
              <ul className="mt-2 space-y-1">
                {preview.errors.slice(0, ERRORS_SHOWN).map((e) => (
                  <li key={`${String(e.line)}-${e.column}-${e.code}`}>
                    {t('csvErrorLine', {
                      line: e.line,
                      column: e.column,
                      problem: t(csvProblemKey(e.code)),
                    })}
                  </li>
                ))}
              </ul>
              {preview.errors.length > ERRORS_SHOWN ? (
                <p className="mt-2 text-xs">{t('csvMoreErrors', { shown: ERRORS_SHOWN })}</p>
              ) : null}
            </div>
          ) : null}

          {clean && hasChanges ? (
            <div>
              <h4 className="text-sm font-extrabold text-ink">{t('csvChangesTitle')}</h4>
              <ul className="mt-2 divide-y divide-line-card rounded-lg border border-line-card text-sm">
                {preview.changes.slice(0, CHANGES_SHOWN).map((c) => (
                  <li key={c.sku} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-3 py-2">
                    <span className="font-bold text-ink">{c.sku}</span>
                    {c.stock ? (
                      <span>{t('csvChangeStock', { from: c.stock.from, to: c.stock.to })}</span>
                    ) : null}
                    {c.active ? <span>{t(c.active.to ? 'csvChangeOn' : 'csvChangeOff')}</span> : null}
                    {c.price ? (
                      <span>
                        {t(c.price.currentPaise === null ? 'csvChangeNew' : 'csvChangePrice', {
                          price: formatPrice(c.price.requestedPaise),
                        })}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              {preview.changes.length > CHANGES_SHOWN ? (
                <p className="mt-1 text-xs text-muted">{t('csvMore', { shown: CHANGES_SHOWN })}</p>
              ) : null}
            </div>
          ) : null}
          {clean && !hasChanges ? <p className="text-sm text-muted">{t('csvNoChanges')}</p> : null}

          <div className="flex flex-wrap items-center gap-2">
            {clean && hasChanges ? (
              <button
                type="button"
                disabled={working}
                onClick={() => void onApply()}
                className={portalPrimary}
              >
                {step.kind === 'applying' ? t('csvApplying') : t('csvApply')}
              </button>
            ) : null}
            <button type="button" disabled={working} onClick={reset} className={portalQuiet}>
              {t('csvAnother')}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
