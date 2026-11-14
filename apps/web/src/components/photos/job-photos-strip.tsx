'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { PHOTO_STAGES, type ServicePhoto } from '@mechdost/shared/service-photos';
import { track } from '@/lib/analytics';
import { PhotoThumb, PhotoViewer } from './photo-viewer';

/**
 * The customer's before/after strip on their request page (spec 06 "Job photos"): their own request's photos in two
 * groups, a viewer on tap. Reloaded when the request's version changes (a new photo arrives with a status move). Shows
 * nothing at all until the first photo exists; a failed load is silent (the page works without it).
 */
export function JobPhotosStrip({ code, version }: { code: string; version: number }) {
  const t = useTranslations('photos');
  const locale = useLocale();
  const [photos, setPhotos] = useState<ServicePhoto[]>([]);
  const [viewing, setViewing] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void import('@/lib/photos-api').then(async ({ fetchCustomerPhotos }) => {
      const res = await fetchCustomerPhotos(locale, code);
      if (live && res.ok) setPhotos(res.data.photos);
    });
    return () => {
      live = false;
    };
  }, [code, locale, version]);

  if (photos.length === 0) return null;
  return (
    <section
      aria-labelledby={`${code}-photos-title`}
      className="rounded-card border border-line-card bg-surface p-6 shadow-card"
    >
      <h2 id={`${code}-photos-title`} className="font-heading text-lg font-extrabold text-ink">
        {t('customerTitle')}
      </h2>
      <div className="mt-4 space-y-4">
        {PHOTO_STAGES.map((stage) => {
          const mine = photos.filter((p) => p.stage === stage);
          if (mine.length === 0) return null;
          return (
            <div key={stage}>
              <h3 className="text-sm font-bold text-ink">{t(`stage_${stage}`)}</h3>
              <ul className="mt-2 flex flex-wrap gap-2">
                {mine.map((p, i) => (
                  <li key={p.id}>
                    <PhotoThumb
                      photo={p}
                      index={i}
                      total={mine.length}
                      onOpen={() => {
                        setViewing(photos.findIndex((x) => x.id === p.id));
                        track('service_photos_viewed', { surface: 'request', count: photos.length });
                      }}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <PhotoViewer
        photos={photos}
        index={viewing}
        onIndex={setViewing}
        onClose={() => {
          setViewing(null);
        }}
      />
    </section>
  );
}
