'use client';

import { useTranslations } from 'next-intl';

export interface PinChoice {
  pincode: string;
  area: string | null;
}

export interface PincodeLookup {
  pincode: string | null;
  area: string | null;
  /** MechDost's nearest PINs to pick from; empty when the PIN is known or the position is outside served areas. */
  candidates: PinChoice[];
}

/**
 * GPS → PIN code through our server (`/api/geo/pincode`, spec 06). Inside a served city the server fills nothing
 * and returns the nearest MechDost PINs to choose from (the nearest post office is not always the person's PIN);
 * null when unknown or offline.
 */
export async function lookupPincode(
  pos: { lat: number; lng: number },
  locale: string,
): Promise<PincodeLookup | null> {
  try {
    const res = await fetch(
      `/api/geo/pincode?lat=${pos.lat.toFixed(5)}&lng=${pos.lng.toFixed(5)}&locale=${locale === 'hi' ? 'hi' : 'en'}`,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<PincodeLookup>;
    return { pincode: body.pincode ?? null, area: body.area ?? null, candidates: body.candidates ?? [] };
  } catch {
    return null;
  }
}

/**
 * "Which PIN is yours?" — shown under the PIN field after "use my location" inside a served area. One tap fills
 * the field (still editable); the position the person gave is kept.
 */
export function PincodeChoices({
  choices,
  selected,
  onPick,
}: {
  choices: PinChoice[];
  selected: string;
  onPick: (pincode: string, index: number) => void;
}) {
  const t = useTranslations('finder');
  if (choices.length === 0) return null;
  return (
    <div role="group" aria-labelledby="finder-pin-choices" className="mt-3">
      <p id="finder-pin-choices" className="text-xs font-bold text-muted">
        {t('pinWhich')}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {choices.map((c, i) => (
          <button
            key={c.pincode}
            type="button"
            aria-pressed={selected === c.pincode}
            onClick={() => {
              onPick(c.pincode, i);
            }}
            className="press inline-flex min-h-11 flex-col items-start justify-center rounded-input border border-input-border bg-surface px-3 py-1 text-left text-sm text-ink aria-pressed:border-accent-button aria-pressed:bg-accent-soft aria-pressed:text-accent-soft-text"
          >
            <span className="font-bold">{c.pincode}</span>
            {c.area ? <span className="text-xs">{c.area}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
