'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import type { PublicGallery } from '@mechdost/shared/service-photos';
import { track } from '@/lib/analytics';
import { PhotoThumb, PhotoViewer } from './photo-viewer';

/**
 * Recent work on a workshop's public page (spec 06 "Job photos"): after photos first, newest job first, at most 12.
 * Renders nothing while the admin keeps photos private, while there are none, or if the load fails: the profile page
 * never shows an empty frame. Lazy images in fixed boxes, so nothing shifts.
 */
export function WorkshopGallery({ slug }: { slug: string }) {
  const t = useTranslations('photos');
  const [gallery, setGallery] = useState<PublicGallery | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void import('@/lib/photos-api').then(async ({ fetchWorkshopGallery }) => {
      const res = await fetchWorkshopGallery(slug);
      if (live && res.ok) setGallery(res.data);
    });
    return () => {
      live = false;
    };
  }, [slug]);

  if (!gallery?.enabled || gallery.photos.length === 0) return null;
  const photos = gallery.photos;
  return (
    <section aria-labelledby="gallery-title">
      <h2 id="gallery-title" className="font-heading text-xl font-extrabold text-ink">
        {t('galleryTitle')}
      </h2>
      <p className="mt-1 text-sm text-muted">{t('galleryLead')}</p>
      <ul className="mt-4 flex flex-wrap gap-2">
        {photos.map((p, i) => (
          <li key={p.id}>
            <PhotoThumb
              photo={p}
              index={i}
              total={photos.length}
              onOpen={(n) => {
                setViewing(n);
                track('service_photos_viewed', { surface: 'workshop', count: photos.length });
              }}
            />
          </li>
        ))}
      </ul>
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
