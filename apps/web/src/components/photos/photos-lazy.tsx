'use client';

import { lazy, Suspense } from 'react';
import type { ServiceRequestStatus } from '@mechdost/shared/state';

/**
 * The photo screens, loaded on demand and only on the pages that show them (JS budget, coordinator 2026-11-15; learning
 * L79: `React.lazy`, no extra runtime). Nothing in the header, layout or shop pages imports this file. Each fallback
 * is an empty, same-purpose placeholder, so nothing shifts when the chunk arrives.
 */
const Panel = lazy(() => import('./job-photos-panel').then((m) => ({ default: m.JobPhotosPanel })));
const Strip = lazy(() => import('./job-photos-strip').then((m) => ({ default: m.JobPhotosStrip })));
const Gallery = lazy(() => import('./workshop-gallery').then((m) => ({ default: m.WorkshopGallery })));

export function JobPhotosPanelLazy(props: {
  code: string;
  status: ServiceRequestStatus;
  onChanged?: () => void;
}) {
  return (
    <Suspense fallback={null}>
      <Panel {...props} />
    </Suspense>
  );
}

export function JobPhotosStripLazy(props: { code: string; version: number }) {
  return (
    <Suspense fallback={null}>
      <Strip {...props} />
    </Suspense>
  );
}

export function WorkshopGalleryLazy(props: { slug: string }) {
  return (
    <Suspense fallback={null}>
      <Gallery {...props} />
    </Suspense>
  );
}
