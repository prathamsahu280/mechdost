/**
 * Partner kit (design 2026-11-27 "Partner portals UI upgrade" § 4). Shared by the shop, workshop and rider portals;
 * import it only from `/partner/*` routes and partner components (never from storefront chrome: JS budget, spec 16).
 * Owner: batch 0. Other batches import, never edit.
 */
export { PartnerFrame, PartnerStrip, type PartnerStateTone } from './partner-frame';
export { PartnerTabs, useCurrentTab, type PartnerTab } from './partner-tabs';
export { KpiTile, type KpiTone } from './kpi-tile';
export { OfferTimer } from './offer-timer';
export { LaneTabs, type Lane } from './lane-tabs';
export { MasterDetail, MasterRow } from './master-detail';
export { isWideNow } from './wide-layout';
export { StepRail } from './step-rail';
export { BulletBar } from './bullet-bar';
export { useNewWorkAlert, type NewWorkAlert } from './new-work-alert';
export { OrderSoundButton } from './order-sound-button';
export { UpdatedAgo } from './updated-ago';
export { DailyBars, DataTable } from '@/components/portal/analytics-charts';
export { countText, laneFrom, offerTimerState } from '@/lib/partner-kit';
