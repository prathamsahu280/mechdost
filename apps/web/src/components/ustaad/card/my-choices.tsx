'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useId, useRef, useState } from 'react';
import type { Choices, ChoicesView } from '@mechdost/shared/ustaad/dto/members';
import { ustaadClient } from '@/lib/ustaad/client';
import { correctionModeChoices } from '@/lib/ustaad/voice-consent';
import { card, LoadingBlock, useUstaad } from '../common';

/**
 * "My choices" on Me (G17, SIM-P10): the smart-correction mode, "Fix by itself" included, when the admin lets members
 * choose, and the two purpose consents asked inside the network (store and play my voice notes; send my typed text to
 * the correction service). Each change saves at once (one consent row per change, conditional on the member version).
 */
export function MyChoices() {
  const t = useTranslations('ustaad.media');
  const locale = useLocale();
  const ids = useId();
  const { loaded, set } = useUstaad((c) => c.choices(), 'my-choices');
  const [status, setStatus] = useState('');
  const busy = useRef(false);

  if (loaded.state === 'loading') return <LoadingBlock />;
  if (loaded.state === 'error') return null;
  const v = loaded.data;
  const modes = correctionModeChoices(v.canChangeCorrection);
  const current = v.correctionMode ?? 'suggest';

  async function save(body: Omit<Choices, 'expectedVersion'>, view: ChoicesView) {
    if (busy.current) return;
    busy.current = true;
    const r = await (await ustaadClient(locale)).saveChoices({ ...body, expectedVersion: view.version });
    busy.current = false;
    if (!r.ok) {
      setStatus(t('voiceConsentFailed'));
      return;
    }
    set(r.data);
    setStatus(t('choicesSaved'));
  }

  const consentRow = (purpose: 'ustaad_voice' | 'ustaad_correction', label: string) => (
    <label className="flex min-h-12 items-start gap-3 text-[15px] text-ink">
      <input
        type="checkbox"
        className="mt-1 size-5 shrink-0 accent-accent-button"
        checked={v.consents[purpose]}
        onChange={(e) => void save({ consents: { [purpose]: e.target.checked } }, v)}
        data-track={`ustaad_choice_${purpose}`}
      />
      <span>{label}</span>
    </label>
  );

  return (
    <section aria-labelledby={`${ids}-h`} className={`${card} grid gap-4`}>
      <h2 id={`${ids}-h`} className="font-heading text-xl font-extrabold text-ink">
        {t('choicesH')}
      </h2>
      {modes.length > 0 ? (
        <fieldset className="grid gap-2">
          <legend className="mb-1 text-[15px] font-bold text-ink">{t('correctionH')}</legend>
          {modes.map((m) => (
            <label key={m} className="flex min-h-12 items-center gap-3 text-[15px] text-ink">
              <input
                type="radio"
                name={`${ids}-mode`}
                className="size-5 shrink-0 accent-accent-button"
                checked={current === m}
                onChange={() => void save({ correctionMode: m }, v)}
                data-track={`ustaad_choice_correction_${m}`}
              />
              {t(`correction_${m}`)}
            </label>
          ))}
        </fieldset>
      ) : null}
      <div className="grid gap-1">
        {consentRow('ustaad_voice', t('consentVoice'))}
        {consentRow('ustaad_correction', t('consentCorrection'))}
      </div>
      <p role="status" className="text-sm font-bold text-ink empty:sr-only">
        {status}
      </p>
    </section>
  );
}
