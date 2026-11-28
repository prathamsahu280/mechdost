import { Suspense } from 'react';
import { WorkshopPortal } from '@/components/portal/workshop-portal';

/** Workshop portal, Calendar tab: a 7-day strip and the chosen day's visits by hour; `?day=` keeps the day (design § 6.4). */
export default function WorkshopCalendarPage() {
  return (
    <Suspense fallback={<div className="skeleton h-96 rounded-card" aria-hidden="true" />}>
      <WorkshopPortal tab="calendar" />
    </Suspense>
  );
}
