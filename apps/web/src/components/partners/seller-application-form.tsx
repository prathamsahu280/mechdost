'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useState, type SyntheticEvent } from 'react';
import { isGstEnrolmentNumber, isGstin } from '@mechdost/shared/gst';
import { SellerApplicationSchema, type Location, type SellerApplication } from '@mechdost/shared/partners';
import { DEMO_PRODUCTS } from '@/demo/catalogue';
import { createApplication } from '@/demo/store';
import { track } from '@/lib/analytics';
import { AUTH_MODE } from '@/lib/auth/mode';
import { applyErrorView, type ApplyFormError } from '@/lib/partner-onboarding-view';
import { LocationPicker } from './location-picker';
import { ProductPicker } from './product-picker';

type Field =
  | 'name'
  | 'phone'
  | 'email'
  | 'businessName'
  | 'shopName'
  | 'gstNumber'
  | 'addressLine'
  | 'pincode'
  | 'location'
  | 'productSlugs'
  | 'consent';

const FIELD_ORDER: Field[] = [
  'name',
  'phone',
  'email',
  'businessName',
  'shopName',
  'gstNumber',
  'addressLine',
  'pincode',
  'location',
  'productSlugs',
  'consent',
];

/**
 * Apply as a seller (design 2026-11-13): GST status (GSTIN or enrolment number), address, the shop's map pin and a
 * tick-list of the products sold. Checked with the same schema as the API (`SellerApplicationSchema`, GSTIN
 * checksum included). With an invite, name, email and mobile number come from the invite and are locked.
 * Real sign-in builds post to `/v1/partner-applications` (or the invite route) with a Turnstile token; the API
 * client loads only then (`import()`), so the demo bundle is unchanged. The demo keeps the browser store.
 */
const REAL = AUTH_MODE === 'firebase';
const TURNSTILE_ID = 'seller-turnstile';
/** A well-formed stand-in for the client check when the invite's number is masked; the API uses the invite's. */
const MASKED_PHONE_STANDIN = '+916000000000';

export function SellerApplicationForm({
  invite,
}: {
  /** `phoneMasked`: real builds only show the last 4 digits; the API takes the number from the invite. */
  invite?: { token: string; name: string; email: string; phone: string; phoneMasked?: boolean };
}) {
  const t = useTranslations('apply');
  const locale = useLocale();
  const router = useRouter();
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [gstStatus, setGstStatus] = useState<'registered' | 'enrolled'>('registered');
  const [location, setLocation] = useState<Location | null>(null);
  const [products, setProducts] = useState<string[]>([]);
  const [formError, setFormError] = useState<ApplyFormError | null>(null);
  const [challenge, setChallenge] = useState(false);

  const messages: Record<Field, string> = {
    name: t('errName'),
    phone: t('errPhone'),
    email: t('errEmail'),
    businessName: t('errBusiness'),
    shopName: t('errShopName'),
    gstNumber: gstStatus === 'registered' ? t('errGstin') : t('errEnrolment'),
    addressLine: t('errAddress'),
    pincode: t('errPincode'),
    location: t('errLocation'),
    productSlugs: t('errProducts'),
    consent: t('errConsent'),
  };

  function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const value = (k: string) => {
      const v = data.get(k);
      return typeof v === 'string' ? v.trim() : '';
    };
    const candidate = {
      name: invite?.name ?? value('name'),
      phone: invite?.phoneMasked ? MASKED_PHONE_STANDIN : (invite?.phone ?? value('phone')),
      email: invite?.email ?? value('email'),
      businessName: value('businessName'),
      shopName: value('shopName'),
      gstStatus,
      gstNumber: value('gstNumber').toUpperCase(),
      addressLine: value('addressLine'),
      ...(value('landmark') ? { landmark: value('landmark') } : {}),
      pincode: value('pincode'),
      location,
      productSlugs: products,
      consent: data.get('consent') === 'on',
    };
    const parsed = SellerApplicationSchema.safeParse(candidate);
    if (!parsed.success) {
      const bad = new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')));
      // Zod runs the schema's GST-number refinement only once every other field is valid; check it here too so a
      // wrong GSTIN shows next to its field in the first round of errors.
      const gstOk =
        gstStatus === 'registered' ? isGstin(candidate.gstNumber) : isGstEnrolmentNumber(candidate.gstNumber);
      if (!gstOk) bad.add('gstNumber');
      const next: Partial<Record<Field, string>> = {};
      for (const f of FIELD_ORDER) if (bad.has(f)) next[f] = messages[f];
      setErrors(next);
      const first = FIELD_ORDER.find((f) => next[f]);
      if (first) document.getElementById(`seller-${first}`)?.focus();
      return;
    }
    setErrors({});
    setFormError(null);
    setSubmitting(true);
    const app = parsed.data;
    if (REAL) {
      void sendToApi(app);
      return;
    }
    const created = createApplication(
      {
        kind: 'seller',
        name: app.name,
        phone: app.phone.replace(/^\+91/, ''),
        business: app.businessName,
        pincode: app.pincode,
        vehicles: [],
        details: '',
        email: app.email,
        shopName: app.shopName,
        gstStatus: app.gstStatus,
        gstNumber: app.gstNumber,
        addressLine: app.addressLine,
        ...(app.landmark ? { landmark: app.landmark } : {}),
        location: app.location,
        productSlugs: app.productSlugs,
        // What the new shop is routed for once approved (Q89); the picker already loads the catalogue.
        categories: [
          ...new Set(
            app.productSlugs.flatMap((s) => DEMO_PRODUCTS.find((p) => p.slug === s)?.category ?? []),
          ),
        ],
        source: invite ? 'invite' : 'public',
      },
      invite?.token,
    );
    track('click', {
      id: invite ? 'partner_application_seller_invite' : 'partner_application_seller',
      path: window.location.pathname,
    });
    router.push(`${locale === 'hi' ? '/hi' : ''}/partners/applications/${created.code}?new=1`);
  }

  /** Real builds: Turnstile, then the API; refusals show next to the fields the API names, or above the form. */
  async function sendToApi(app: SellerApplication) {
    const fail = (code: string, fields: readonly string[] = []) => {
      const view = applyErrorView(code, fields);
      const next: Partial<Record<Field, string>> = {};
      for (const f of FIELD_ORDER) {
        if (!(f in view.fields)) continue;
        const key = view.fields[f];
        next[f] = key ? t(key) : messages[f];
      }
      setErrors(next);
      setFormError(view.form);
      setSubmitting(false);
      const first = FIELD_ORDER.find((f) => next[f]);
      document.getElementById(first ? `seller-${first}` : 'seller-form-error')?.focus();
    };
    let token: string;
    try {
      const { turnstileToken } = await import('@/lib/auth/turnstile');
      token = await turnstileToken(TURNSTILE_ID, locale, setChallenge);
    } catch {
      fail('TURNSTILE_FAILED');
      return;
    }
    const { submitApplication } = await import('@/lib/partner-public-api');
    // With an invite the API takes name, email and mobile number from the invite, never from the form.
    const { name: _name, email: _email, phone: _phone, ...own } = app;
    const res = await submitApplication(invite ? own : app, token, invite?.token);
    if (!res.ok) {
      fail(res.code, res.fields);
      return;
    }
    track('click', {
      id: invite ? 'partner_application_seller_invite' : 'partner_application_seller',
      path: window.location.pathname,
    });
    router.push(`${locale === 'hi' ? '/hi' : ''}/partners/applications/${res.code}?new=1`);
  }

  const input =
    'mt-1 min-h-11 w-full rounded-input border border-input-border bg-surface px-3 text-[15px] text-ink placeholder:text-muted aria-[invalid=true]:border-error read-only:bg-surface-alt';
  const aria = (id: Field) => ({
    id: `seller-${id}`,
    'aria-invalid': errors[id] ? true : undefined,
    'aria-describedby': errors[id] ? `seller-${id}-error` : undefined,
  });
  const err = (id: Field) =>
    errors[id] ? (
      <p id={`seller-${id}-error`} className="mt-1 text-xs font-bold text-error">
        {errors[id]}
      </p>
    ) : null;
  const label = (id: string, text: string) => (
    <label htmlFor={id} className="text-sm font-bold text-ink">
      {text}
    </label>
  );

  return (
    <form noValidate onSubmit={onSubmit} className="space-y-5">
      {invite ? (
        <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm font-bold text-accent-soft-text">
          {t('invitedNote')}
        </p>
      ) : null}
      {formError ? (
        <p
          id="seller-form-error"
          role="alert"
          tabIndex={-1}
          className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning"
        >
          {t(formError)}
        </p>
      ) : null}
      {Object.keys(errors).length > 0 ? (
        <p role="alert" className="rounded-lg bg-warning-bg px-3 py-2 text-sm font-bold text-warning">
          {t('errorSummary')}
        </p>
      ) : null}

      <div className="grid gap-4 min-[600px]:grid-cols-2">
        <div>
          {label('seller-name', t('name'))}
          <input
            {...aria('name')}
            name="name"
            autoComplete="name"
            maxLength={80}
            defaultValue={invite?.name}
            readOnly={Boolean(invite)}
            className={input}
          />
          {err('name')}
        </div>
        <div>
          {label('seller-phone', t('phone'))}
          <input
            {...aria('phone')}
            name="phone"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            maxLength={14}
            defaultValue={invite?.phone}
            readOnly={Boolean(invite)}
            className={input}
          />
          {err('phone')}
        </div>
        <div className="min-[600px]:col-span-2">
          {label('seller-email', t('email'))}
          <input
            {...aria('email')}
            name="email"
            type="email"
            autoComplete="email"
            maxLength={120}
            defaultValue={invite?.email}
            readOnly={Boolean(invite)}
            className={input}
          />
          {err('email')}
        </div>
        <div>
          {label('seller-businessName', t('businessNameGst'))}
          <input
            {...aria('businessName')}
            name="businessName"
            autoComplete="organization"
            maxLength={120}
            className={input}
          />
          {err('businessName')}
        </div>
        <div>
          {label('seller-shopName', t('shopName'))}
          <input {...aria('shopName')} name="shopName" maxLength={80} className={input} />
          {err('shopName')}
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-bold text-ink">{t('gstLabel')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(['registered', 'enrolled'] as const).map((s) => (
            <label
              key={s}
              className="press inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-button border border-input-border px-4 text-sm font-bold text-ink has-checked:border-accent-button has-checked:bg-accent-soft has-checked:text-accent-soft-text"
            >
              <input
                type="radio"
                name="gstStatus"
                value={s}
                checked={gstStatus === s}
                onChange={() => {
                  setGstStatus(s);
                }}
                className="size-5 accent-[var(--color-accent-button)]"
              />
              {s === 'registered' ? t('gstRegistered') : t('gstEnrolled')}
            </label>
          ))}
        </div>
        {gstStatus === 'enrolled' ? <p className="mt-2 text-xs text-muted">{t('gstEnrolledHint')}</p> : null}
        <div className="mt-3">
          {label('seller-gstNumber', gstStatus === 'registered' ? t('gstinLabel') : t('enrolmentLabel'))}
          <input
            {...aria('gstNumber')}
            name="gstNumber"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={15}
            className={`${input} uppercase`}
          />
          {err('gstNumber')}
        </div>
      </fieldset>

      <div className="grid gap-4 min-[600px]:grid-cols-2">
        <div className="min-[600px]:col-span-2">
          {label('seller-addressLine', t('addressLine'))}
          <input
            {...aria('addressLine')}
            name="addressLine"
            autoComplete="street-address"
            maxLength={200}
            className={input}
          />
          {err('addressLine')}
        </div>
        <div>
          {label('seller-landmark', t('landmark'))}
          <input id="seller-landmark" name="landmark" maxLength={120} className={input} />
        </div>
        <div>
          {label('seller-pincode', t('pincode'))}
          <input
            {...aria('pincode')}
            name="pincode"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={6}
            className={input}
          />
          {err('pincode')}
        </div>
      </div>

      <div id="seller-location" tabIndex={-1}>
        <p className="text-sm font-bold text-ink">{t('locationLabel')}</p>
        <p className="mt-1 text-xs text-muted">{t('locationHelp')}</p>
        <div className="mt-2">
          <LocationPicker
            value={location}
            onChange={setLocation}
            invalid={Boolean(errors.location)}
            describedBy={errors.location ? 'seller-location-error' : undefined}
          />
        </div>
        {err('location')}
      </div>

      <div id="seller-productSlugs" tabIndex={-1}>
        <p className="text-sm font-bold text-ink">{t('productsLabel')}</p>
        <p className="mt-1 text-xs text-muted">{t('productsHint')}</p>
        <div className="mt-2">
          <ProductPicker
            value={products}
            onChange={setProducts}
            invalid={Boolean(errors.productSlugs)}
            describedBy={errors.productSlugs ? 'seller-productSlugs-error' : undefined}
          />
        </div>
        {err('productSlugs')}
      </div>

      <label className="flex items-start gap-3 text-sm text-ink">
        <input
          {...aria('consent')}
          type="checkbox"
          name="consent"
          className="mt-0.5 size-5 accent-[var(--color-accent-button)]"
        />
        <span>{t('consent')}</span>
      </label>
      {err('consent')}

      {REAL ? (
        <div role="group" aria-labelledby={challenge ? 'seller-turnstile-label' : undefined}>
          <p id="seller-turnstile-label" hidden={!challenge} className="text-sm font-bold text-ink">
            {t('api_securityCheck')}
          </p>
          <div id={TURNSTILE_ID} />
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting}
        className="press min-h-11 w-full rounded-button bg-accent-button px-6 text-sm font-bold text-white hover:bg-accent-button-hover disabled:opacity-60 min-[600px]:w-auto"
      >
        {submitting ? t('submitting') : t('submit')}
      </button>
    </form>
  );
}
