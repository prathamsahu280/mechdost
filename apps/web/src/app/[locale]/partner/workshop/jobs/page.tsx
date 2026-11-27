import { Suspense } from 'react';
import { WorkshopPortal } from '@/components/portal/workshop-portal';

/** Workshop portal, Jobs tab: lanes with counts; `?lane=` and `?job=` keep the place (design 2026-11-27 § 6.1). */
export default function WorkshopJobsPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-card" aria-hidden="true" />}>
      <WorkshopPortal tab="jobs" />
    </Suspense>
  );
}
