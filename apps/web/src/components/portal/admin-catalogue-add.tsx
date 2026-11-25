'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useId, useState, type ChangeEvent, type SyntheticEvent } from 'react';
import {
  AdminCategoryList,
  AdminImportFileProblem,
  AdminImportProblems,
  AdminImportReport,
  AdminProductCreated,
  type AdminImportProblemsDto,
  type AdminImportReportDto,
} from '@mechdost/shared/admin-catalogue';
import { PRODUCT_GST_RATES_BP } from '@mechdost/shared/catalogue-import';
import { NET_UNITS, type AttributeDef } from '@mechdost/shared/product-attributes';
import { VEHICLE_LABEL_KEY, VEHICLE_TYPES } from '@mechdost/shared/vehicles';
import {
  addErrorKey,
  attributesFor,
  fileTooBig,
  IMPORT_TEMPLATE,
  readNewProduct,
  rowProblemKey,
  type CategoryOption,
} from '@/lib/admin-catalogue-add';
import { adminApi } from '@/lib/admin-api';
import { errorKey } from '@/lib/admin-prices-view';
import { track } from '@/lib/analytics';
import { portalField, portalPrimary, portalQuiet } from './portal-styles';
import { adminCard } from './admin-ui';

/**
 * Admin → Catalogue → Add product and Import CSV (plan 2026-11-14 Stream B; spec 08 Catalogue). Real API only
 * (loaded inside the editor). The form creates a draft with its first pack; the import is checked as a dry run
 * first and imported in one go (`docs/runbooks/catalogue-import.md`).
 */
type Notice = { kind: 'ok' | 'error'; text: string } | null;

function NoticeLine({ notice }: { notice: Notice }) {
  if (!notice) return null;
  return (
    <p
      role={notice.kind === 'error' ? 'alert' : 'status'}
      className={`text-sm font-bold ${notice.kind === 'error' ? 'text-error' : 'text-success'}`}
    >
      {notice.text}
    </p>
  );
}

function Field({
  name,
  label,
  hint,
  long,
  lang,
  required,
  maxLength,
}: {
  name: string;
  label: string;
  hint?: string;
  long?: boolean;
  lang?: 'en' | 'hi';
  required?: boolean;
  maxLength: number;
}) {
  const id = `add-${name}`;
  return (
    <div className={long ? 'nav:col-span-2' : undefined}>
      <label htmlFor={id} className="text-xs font-bold text-muted">
        {label}
      </label>
      {long ? (
        <textarea
          id={id}
          name={name}
          rows={3}
          maxLength={maxLength}
          lang={lang}
          className={`${portalField} py-2`}
        />
      ) : (
        <input
          id={id}
          name={name}
          maxLength={maxLength}
          lang={lang}
          required={required}
          aria-describedby={hint ? `${id}-hint` : undefined}
          className={portalField}
        />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function AttributeField({ def }: { def: AttributeDef }) {
  const t = useTranslations('portal');
  const c = useTranslations('compare');
  const id = `add-attr-${def.key}`;
  const label = c(`attr.${def.key}` as 'attr.voltage');
  const unit = def.unit === 'months' ? t('cat_add_months') : def.unit;
  const valueLabel = (v: string) =>
    def.translate
      ? c(`value.${def.key}.${v}` as 'value.batteryType.vrla')
      : def.prefix
        ? `${def.prefix} ${v}`
        : v;
  return (
    <div>
      <label htmlFor={id} className="text-xs font-bold text-muted">
        {unit ? `${label} (${unit})` : label}
      </label>
      {def.kind === 'enum' || def.kind === 'boolean' ? (
        <select id={id} name={`attr_${def.key}`} defaultValue="" className={portalField}>
          <option value="">{t('cat_add_attrNone')}</option>
          {def.kind === 'boolean' ? (
            <>
              <option value="yes">{t('cat_add_yes')}</option>
              <option value="no">{t('cat_add_no')}</option>
            </>
          ) : (
            (def.values ?? []).map((v) => (
              <option key={v} value={v}>
                {valueLabel(v)}
              </option>
            ))
          )}
        </select>
      ) : (
        <input
          id={id}
          name={`attr_${def.key}`}
          inputMode={def.kind === 'text' ? 'text' : 'decimal'}
          maxLength={40}
          className={portalField}
        />
      )}
    </div>
  );
}

const TEXTS: { name: string; max: number; long?: boolean; lang: 'en' | 'hi' }[] = [
  { name: 'nameHi', max: 160, lang: 'hi' },
  { name: 'specSummary', max: 200, lang: 'en' },
  { name: 'specSummaryHi', max: 200, lang: 'hi' },
  { name: 'compatibility', max: 300, lang: 'en' },
  { name: 'compatibilityHi', max: 300, lang: 'hi' },
  { name: 'description', max: 4000, long: true, lang: 'en' },
  { name: 'descriptionHi', max: 4000, long: true, lang: 'hi' },
];

/** The add-product form: category first (it decides the specification fields), then texts, fit and the pack. */
export function AddProductForm({ onCreated }: { onCreated: (slug: string) => void }) {
  const t = useTranslations('portal');
  const c = useTranslations('catalogue');
  const locale = useLocale();
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [category, setCategory] = useState<CategoryOption | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void adminApi(locale, `/catalogue/categories?locale=${locale}`, AdminCategoryList).then((res) => {
      if (res.ok) setCategories(res.data.categories);
      else setNotice({ kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') });
    });
  }, [locale, t]);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const get = (n: string) => {
      const v = data.get(n);
      return typeof v === 'string' ? v.trim() : '';
    };
    const read = readNewProduct(get, { category, vehicleTypes: types, publish: get('publish') === 'on' });
    if (!read.ok) {
      setNotice({ kind: 'error', text: t(read.key as 'cat_add_err_REQUIRED') });
      return;
    }
    setBusy(true);
    const res = await adminApi(locale, '/admin/catalogue/products', AdminProductCreated, {
      method: 'POST',
      body: read.body,
    });
    setBusy(false);
    if (!res.ok) {
      setNotice({ kind: 'error', text: t(addErrorKey(res.code) as 'cat_add_err_REQUIRED') });
      return;
    }
    track('click', { id: 'admin_catalogue_product_added', path: window.location.pathname });
    onCreated(res.data.slug);
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className={`${adminCard} space-y-6`} noValidate>
      <div>
        <h3 className="font-heading text-lg font-extrabold text-ink">{t('cat_add_title')}</h3>
        <p className="mt-1 text-sm text-muted">{t('cat_add_intro')}</p>
      </div>
      <div className="grid gap-3 nav:grid-cols-2">
        <div>
          <label htmlFor="add-category" className="text-xs font-bold text-muted">
            {t('cat_add_category')}
          </label>
          <select
            id="add-category"
            name="category"
            required
            value={category?.slug ?? ''}
            onChange={(e) => {
              setCategory(categories.find((x) => x.slug === e.currentTarget.value) ?? null);
            }}
            className={portalField}
          >
            <option value="">{t('cat_add_categoryPick')}</option>
            {categories.map((x) => (
              <option key={x.slug} value={x.slug}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <Field name="brand" label={t('cat_add_brand')} required maxLength={60} lang="en" />
        <Field name="name" label={t('cat_field_name')} required maxLength={160} lang="en" />
        {TEXTS.map((f) => (
          <Field
            key={f.name}
            name={f.name}
            label={t(`cat_field_${f.name}` as 'cat_field_name')}
            long={f.long}
            lang={f.lang}
            maxLength={f.max}
          />
        ))}
        <Field name="highlights" label={t('cat_add_highlights')} long lang="en" maxLength={1000} />
        <Field name="highlightsHi" label={t('cat_add_highlightsHi')} long lang="hi" maxLength={1000} />
        <Field name="slug" label={t('cat_add_slug')} hint={t('cat_add_slugHint')} maxLength={120} />
      </div>

      <fieldset>
        <legend className="text-sm font-extrabold text-ink">{t('cat_vehicleTypes')}</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          {VEHICLE_TYPES.map((v) => (
            <label key={v} className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={types.includes(v)}
                onChange={(e) => {
                  const on = e.currentTarget.checked;
                  setTypes((prev) => (on ? [...prev, v] : prev.filter((x) => x !== v)));
                }}
                className="size-5"
              />
              {c(VEHICLE_LABEL_KEY[v])}
            </label>
          ))}
        </div>
      </fieldset>

      {attributesFor(category).length > 0 ? (
        <fieldset key={category?.slug}>
          <legend className="text-sm font-extrabold text-ink">{t('cat_add_attributes')}</legend>
          <div className="mt-2 grid gap-3 nav:grid-cols-3">
            {attributesFor(category).map((d) => (
              <AttributeField key={d.key} def={d} />
            ))}
          </div>
        </fieldset>
      ) : null}

      <fieldset>
        <legend className="text-sm font-extrabold text-ink">{t('cat_add_pack')}</legend>
        <div className="mt-2 grid gap-3 nav:grid-cols-3">
          <Field name="sku" label={t('cat_add_sku')} required maxLength={64} />
          <Field name="mrp" label={t('cat_add_mrp')} required maxLength={14} />
          <Field name="hsn" label={t('cat_add_hsn')} required maxLength={8} />
          <div>
            <label htmlFor="add-gst" className="text-xs font-bold text-muted">
              {t('cat_add_gst')}
            </label>
            <select id="add-gst" name="gst" defaultValue="1800" className={portalField}>
              {PRODUCT_GST_RATES_BP.map((bp) => (
                <option key={bp} value={String(bp)}>
                  {t('cat_add_gstOption', { rate: bp / 100 })}
                </option>
              ))}
            </select>
          </div>
          <Field name="packQty" label={t('cat_packQty')} maxLength={7} />
          <div>
            <label htmlFor="add-packUnit" className="text-xs font-bold text-muted">
              {t('cat_packUnit')}
            </label>
            <select id="add-packUnit" name="packUnit" defaultValue="" className={portalField}>
              <option value="">{t('cat_packNone')}</option>
              {NET_UNITS.map((u) => (
                <option key={u} value={u}>
                  {t(`cat_add_unit_${u}`)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="publish" className="size-5" />
        {t('cat_add_publish')}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={portalPrimary}>
          {t('cat_add_submit')}
        </button>
        <NoticeLine notice={notice} />
      </div>
    </form>
  );
}

interface FileProblem {
  reason: string;
  missing?: string[];
  unknown?: string[];
}

/** CSV import: pick a file → check it (dry run) → import what is ready, or fix the listed rows. */
export function ImportCsv({ onImported }: { onImported: () => void }) {
  const t = useTranslations('portal');
  const locale = useLocale();
  const fileId = useId();
  const [csv, setCsv] = useState<string | null>(null);
  const [publish, setPublish] = useState(false);
  const [report, setReport] = useState<AdminImportReportDto | null>(null);
  const [problems, setProblems] = useState<AdminImportProblemsDto | null>(null);
  const [fileProblem, setFileProblem] = useState<FileProblem | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setReport(null);
    setProblems(null);
    setFileProblem(null);
    setNotice(null);
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    reset();
    const file = e.currentTarget.files?.[0];
    if (!file) {
      setCsv(null);
      return;
    }
    const text = await file.text();
    if (fileTooBig(text)) {
      setCsv(null);
      setFileProblem({ reason: 'TOO_BIG' });
      return;
    }
    setCsv(text);
  }

  async function send(dryRun: boolean) {
    if (csv === null) {
      setNotice({ kind: 'error', text: t('cat_import_pick') });
      return;
    }
    reset();
    setBusy(true);
    const res = await adminApi(locale, '/admin/catalogue/import', AdminImportReport, {
      method: 'POST',
      body: { csv, dryRun, publish },
    });
    setBusy(false);
    if (res.ok) {
      track('click', {
        id: dryRun ? 'admin_catalogue_import_checked' : 'admin_catalogue_imported',
        path: window.location.pathname,
      });
      if (dryRun) setReport(res.data);
      else {
        setNotice({ kind: 'ok', text: t('cat_import_done', { count: res.data.created.length }) });
        setCsv(null);
        onImported();
      }
      return;
    }
    if (res.code === 'IMPORT_ROWS_INVALID') {
      const parsed = AdminImportProblems.safeParse(res.details);
      if (parsed.success) {
        setProblems(parsed.data);
        return;
      }
    }
    if (res.code === 'IMPORT_FILE') {
      const parsed = AdminImportFileProblem.safeParse(res.details);
      if (parsed.success) {
        setFileProblem(parsed.data);
        return;
      }
    }
    setNotice({ kind: 'error', text: t(errorKey(res.code) as 'cat_err_generic') });
  }

  const none = t('cat_import_none');
  const ready = report?.created.length ?? 0;

  return (
    <div className={`${adminCard} space-y-4`}>
      <div>
        <h3 className="font-heading text-lg font-extrabold text-ink">{t('cat_import_title')}</h3>
        <p className="mt-1 text-sm text-muted">{t('cat_import_intro')}</p>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(IMPORT_TEMPLATE)}`}
          download="mechdost-catalogue-template.csv"
          className="mt-2 inline-flex min-h-11 items-center text-sm font-bold text-accent-soft-text underline"
        >
          {t('cat_import_template')}
        </a>
      </div>
      <div>
        <label htmlFor={fileId} className="text-xs font-bold text-muted">
          {t('cat_import_file')}
        </label>
        <input
          id={fileId}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => void onFile(e)}
          className={`${portalField} py-2`}
        />
      </div>
      <label className="inline-flex min-h-11 items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={publish}
          onChange={(e) => {
            setPublish(e.currentTarget.checked);
            setReport(null);
          }}
          className="size-5"
        />
        {t('cat_add_publish')}
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy}
          onClick={() => void send(true)}
          className={report && ready > 0 ? portalQuiet : portalPrimary}
        >
          {busy ? t('cat_import_checking') : t('cat_import_check')}
        </button>
        {report && ready > 0 ? (
          <button type="button" disabled={busy} onClick={() => void send(false)} className={portalPrimary}>
            {t('cat_import_run', { count: ready })}
          </button>
        ) : null}
        <NoticeLine notice={notice} />
      </div>

      {fileProblem ? (
        <p role="alert" className="text-sm font-bold text-error">
          {t(`cat_import_file_${fileProblem.reason}` as 'cat_import_file_HEADER', {
            missing: fileProblem.missing?.length ? fileProblem.missing.join(', ') : none,
            unknown: fileProblem.unknown?.length ? fileProblem.unknown.join(', ') : none,
          })}
        </p>
      ) : null}

      {report ? (
        <div role="status" className="space-y-1 text-sm text-ink">
          <p className="font-bold">{t('cat_import_ready', { count: ready })}</p>
          {report.skipped.length > 0 ? (
            <p className="text-muted">{t('cat_import_skipped', { count: report.skipped.length })}</p>
          ) : null}
        </div>
      ) : null}

      {problems ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm font-bold text-error">
            {t('cat_import_problems', { count: problems.errors.length })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-xs text-muted">
                <tr>
                  <th scope="col" className="py-1 pr-4">
                    {t('cat_import_col_row')}
                  </th>
                  <th scope="col" className="py-1 pr-4">
                    {t('cat_import_col_column')}
                  </th>
                  <th scope="col" className="py-1">
                    {t('cat_import_col_problem')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-card">
                {problems.errors.map((p) => (
                  <tr key={`${String(p.row)}-${p.field}`}>
                    <td className="py-1 pr-4 tabular-nums">{p.row}</td>
                    <td className="py-1 pr-4">
                      <code lang="en">{p.field}</code>
                    </td>
                    <td className="py-1">{t(rowProblemKey(p.code) as 'cat_add_err_INVALID')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
