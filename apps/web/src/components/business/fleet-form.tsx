'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import { FLEET_NEEDS } from '@mechdost/shared/business-codes';
import { track } from '@/lib/analytics';
import {
  businessErrorView,
  FLEET_FIELD_ORDER,
  fleetBody,
  validateFleet,
  type FleetField,
  type FleetValues,
} from '@/lib/business-apply-view';
import {
  ChoiceGroup,
  ConsentField,
  CountGroup,
  ErrorSummary,
  FormError,
  SubmitButton,
  TextAreaField,
  TextField,
} from './form-parts';

const EMPTY: FleetValues = {
  companyName: '',
  w2: '',
  w3: '',
  w4: '',
  pincode: '',
  contactName: '',
  phone: '',
  email: '',
  needs: [],
  note: '',
  consent: false,
};
const TURNSTILE_ID = 'business-turnstile';

/**
 * Fleet enquiry (audience entry design 2026-11-22, item 3): a lead, sent signed in or out. Signed out it carries
 * the Turnstile token (spec 13); the contact is what the person types. Needs and sizes are codes and counts.
 */
export function FleetForm({ signedIn, onDone }: { signedIn: boolean; onDone: (code: string) => void }) {
  const t = useTranslations('business');
  const locale = useLocale();
  const [values, setValues] = useState<FleetValues>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FleetField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [challenge, setChallenge] = useState(false);
  const [focus, setFocus] = useState<{ n: number; where: 'summary' | 'form' }>({ n: 0, where: 'summary' });
  const summaryRef = useRef<HTMLDivElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focus.n === 0) return;
    (focus.where === 'summary' ? summaryRef : formErrorRef).current?.focus();
  }, [focus]);

  const set = <K extends keyof FleetValues>(key: K, value: FleetValues[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
  };
  const msg = (f: FleetField) => {
    const key = errors[f];
    return key ? t(key as 'err_fleet') : undefined;
  };

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    const found = validateFleet(values);
    setErrors(found);
    setFormError(null);
    if (Object.keys(found).length > 0) {
      setFocus((f) => ({ n: f.n + 1, where: 'summary' }));
      return;
    }
    setBusy(true);
    let token: string | null = null;
    if (!signedIn) {
      try {
        const { turnstileToken } = await import('@/lib/auth/turnstile');
        token = await turnstileToken(TURNSTILE_ID, locale, setChallenge);
      } catch {
        setBusy(false);
        setFormError(t('errForm_turnstile'));
        setFocus((f) => ({ n: f.n + 1, where: 'form' }));
        return;
      }
    }
    const { submitFleetApplication } = await import('@/lib/business-api');
    const res = await submitFleetApplication(locale, fleetBody(values), token, signedIn);
    setBusy(false);
    if (!res.ok) {
      const view = businessErrorView(res.code);
      if (view.pincode) {
        setErrors({ pincode: 'errForm_pincodeNotServed' });
        setFocus((f) => ({ n: f.n + 1, where: 'summary' }));
        return;
      }
      setFormError(view.form ? t(view.form) : t('errForm_generic'));
      setFocus((f) => ({ n: f.n + 1, where: 'form' }));
      return;
    }
    track('click', { id: 'business_apply_fleet', path: window.location.pathname });
    onDone(res.data.code);
  }

  const labels: Record<FleetField, string> = {
    companyName: t('companyName'),
    fleet: t('legend_fleet'),
    pincode: t('pincode'),
    contactName: t('contactName'),
    phone: t('phone'),
    email: t('email'),
    needs: t('legend_needs'),
    note: t('note'),
    consent: t('consent_fleet'),
  };
  const summary = FLEET_FIELD_ORDER.flatMap((name) => {
    const message = msg(name);
    return message ? [{ name, message, label: labels[name] }] : [];
  });

  return (
    <form noValidate onSubmit={(e) => void onSubmit(e)} className="space-y-5">
      <ErrorSummary items={summary} summaryRef={summaryRef} />
      <div ref={formErrorRef} tabIndex={-1} id="biz-form-error">
        <FormError id="biz-form-error-text" text={formError} />
      </div>

      <TextField
        name="companyName"
        label={labels.companyName}
        required
        autoComplete="organization"
        maxLength={120}
        value={values.companyName}
        onChange={(v) => {
          set('companyName', v);
        }}
        {...(msg('companyName') ? { error: msg('companyName') } : {})}
      />
      <CountGroup
        name="fleet"
        legend={labels.fleet}
        hint={t('fleetHint')}
        {...(msg('fleet') ? { error: msg('fleet') } : {})}
        fields={[
          {
            key: 'w2',
            label: t('w2'),
            value: values.w2,
            onChange: (v) => {
              set('w2', v);
            },
          },
          {
            key: 'w3',
            label: t('w3'),
            value: values.w3,
            onChange: (v) => {
              set('w3', v);
            },
          },
          {
            key: 'w4',
            label: t('w4'),
            value: values.w4,
            onChange: (v) => {
              set('w4', v);
            },
          },
        ]}
      />
      <TextField
        name="pincode"
        label={labels.pincode}
        required
        autoComplete="postal-code"
        inputMode="numeric"
        maxLength={6}
        value={values.pincode}
        onChange={(v) => {
          set('pincode', v);
        }}
        {...(msg('pincode') ? { error: msg('pincode') } : {})}
      />
      <div className="grid gap-4 min-[600px]:grid-cols-2">
        <TextField
          name="contactName"
          label={labels.contactName}
          required
          autoComplete="name"
          maxLength={80}
          value={values.contactName}
          onChange={(v) => {
            set('contactName', v);
          }}
          {...(msg('contactName') ? { error: msg('contactName') } : {})}
        />
        <TextField
          name="phone"
          label={labels.phone}
          required
          type="tel"
          autoComplete="tel-national"
          inputMode="numeric"
          maxLength={14}
          value={values.phone}
          onChange={(v) => {
            set('phone', v);
          }}
          {...(msg('phone') ? { error: msg('phone') } : {})}
        />
      </div>
      <TextField
        name="email"
        label={labels.email}
        required
        type="email"
        autoComplete="email"
        inputMode="email"
        maxLength={120}
        value={values.email}
        onChange={(v) => {
          set('email', v);
        }}
        {...(msg('email') ? { error: msg('email') } : {})}
      />
      <ChoiceGroup
        name="needs"
        legend={labels.needs}
        required
        type="checkbox"
        options={FLEET_NEEDS.map((v) => ({ value: v, label: t(`need_${v}`) }))}
        selected={values.needs}
        onToggle={(v) => {
          set('needs', values.needs.includes(v) ? values.needs.filter((n) => n !== v) : [...values.needs, v]);
        }}
        {...(msg('needs') ? { error: msg('needs') } : {})}
      />
      <TextAreaField
        name="note"
        label={labels.note}
        hint={t('noteHint')}
        maxLength={500}
        value={values.note}
        onChange={(v) => {
          set('note', v);
        }}
        {...(msg('note') ? { error: msg('note') } : {})}
      />
      <ConsentField
        checked={values.consent}
        onChange={(v) => {
          set('consent', v);
        }}
        label={labels.consent}
        {...(msg('consent') ? { error: msg('consent') } : {})}
      />
      {!signedIn ? (
        <div role="group" aria-labelledby={challenge ? 'biz-turnstile-label' : undefined}>
          <p id="biz-turnstile-label" hidden={!challenge} className="text-sm font-bold text-ink">
            {t('securityCheck')}
          </p>
          <div id={TURNSTILE_ID} />
        </div>
      ) : null}
      <SubmitButton busy={busy} label={t('submit_fleet')} busyLabel={t('submitting')} />
    </form>
  );
}
