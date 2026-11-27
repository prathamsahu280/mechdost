/**
 * Types of the delivery-agent screens (spec 24), taken from the shared contract (`@mechdost/shared/delivery/api`) with
 * type-only imports: nothing of Zod reaches a page bundle from here. The clients (`agent-client.ts`,
 * `shop-client.ts`, `admin-client.ts`) implement these against the API; `demo/delivery-clients.ts` against the
 * browser demo store. One set of screens serves both (like the Ustaad messages seam).
 */
import type { ClientEvents } from '@mechdost/shared/analytics';
import type {
  AdminAgentDetail,
  AdminAgentRow,
  AdminDocumentView,
  AdminJobDetail,
  AdminJobRow,
  AdminShopModeRequestRow,
  AgentInvitePreview,
  AgentInviteRow,
  AgentEarnings,
  AgentJobCard,
  AgentJobDetail,
  AgentOwnPayoutRow,
  AgentPayoutInput,
  AgentPayoutPage,
  AgentPayoutRow,
  AgentPayoutSummary,
  AgentProfile,
  CodeStepResult,
  CustomerDeliveryBlock,
  ShopDeliveryModeView,
  ShopOrderDelivery,
} from '@mechdost/shared/delivery/api';
import type {
  AgentDocumentKind,
  AgentDocumentRejectReason,
  AgentStatus,
  AgentStatusReason,
  AgentVehicleType,
  DeliveryDeclineReason,
  DeliveryFailReason,
  DeliveryFailureDecision,
  DeliveryGiveUpReason,
  DeliveryRetryAgent,
  DeliverySwitchDeclineReason,
  DeliverySwitchReason,
  DeliveryRatingReason,
  DeliveryWithdrawReason,
  ShopDeliveryMode,
  ShopModeRejectReason,
  ShopModeRequestReason,
} from '@mechdost/shared/delivery/codes';
import type { ApplicationRejectReason } from '@mechdost/shared/partner-codes';
import { AGENT_PAYOUT_METHODS, DELIVERY_RATING_REASONS } from '@mechdost/shared/delivery/codes';

/** The parsed output of a shared schema, without importing Zod. */
type Out<S> = S extends { parse(data: unknown, ...rest: never[]): infer O } ? O : never;

/** Rider rating reasons (founder ruling 2026-11-26), from the contract (`codes.ts` is Zod-free). */
export const RATING_REASONS = DELIVERY_RATING_REASONS;
export type RatingReason = DeliveryRatingReason;

export type AgentProfileView = Out<typeof AgentProfile>;
export type AgentJobCardView = Out<typeof AgentJobCard>;
export type AgentJobDetailView = Out<typeof AgentJobDetail>;
export type CodeStepView = Out<typeof CodeStepResult>;
export type ShopOrderDeliveryView = Out<typeof ShopOrderDelivery>;
export type ShopDeliveryModeViewT = Out<typeof ShopDeliveryModeView>;
export type CustomerDeliveryView = Out<typeof CustomerDeliveryBlock> & {
  /**
   * Demo only, after a return to the shop: what the refund covers (Lead's call 13). The API's block has no such
   * field (the refund shows on the order's refund lines), so the card words it generally when absent.
   */
  refund?: 'full' | 'parts_only' | null;
};
export type AdminJobRowView = Out<typeof AdminJobRow>;
export type AdminJobDetailView = Out<typeof AdminJobDetail>;
export type AdminAgentRowView = Out<typeof AdminAgentRow>;
export type AdminAgentDetailView = Out<typeof AdminAgentDetail>;
export type AdminDocumentViewT = Out<typeof AdminDocumentView>;
export type AdminShopModeRequestView = Out<typeof AdminShopModeRequestRow>;
export type AgentInviteRowView = Out<typeof AgentInviteRow>;
export type AgentInvitePreviewView = Out<typeof AgentInvitePreview>;

/**
 * A row of `GET /v1/admin/delivery/applications` (spec 24 § 16 G3; phone masked). The contract has no shared schema
 * for it yet, so `api-clients.ts` checks it with a guard; `version` goes back with a reject.
 */
export interface AgentApplicationView {
  code: string;
  name: string;
  vehicleType: AgentVehicleType | null;
  cityCode: string | null;
  status: string;
  reasonCode: string | null;
  createdAt: string;
  version: number;
}
export type { ApplicationRejectReason };

export type Result<T> = { ok: true; data: T } | { ok: false; status: number; code: string };
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export type AgentJobsView = 'offers' | 'active' | 'done';
export type AdminJobsView = 'needs_agent' | 'offered' | 'active' | 'failed' | 'returning' | 'done';
export type PhotoPurpose = 'pickup' | 'delivery' | 'failure' | 'document';

/** Shared by every client: the demo notifies changes; the API is polled. */
interface Live {
  /** True for the browser demo (screens say the data is sample data). */
  readonly sample: boolean;
  /** Demo only: called on every change in this browser. */
  subscribe?: (onChange: () => void) => () => void;
}

export interface AgentClient extends Live {
  me(): Promise<Result<AgentProfileView>>;
  setOnline(online: boolean, version: number): Promise<Result<AgentProfileView>>;
  jobs(view: AgentJobsView, cursor: string | null): Promise<Result<Page<AgentJobCardView>>>;
  job(jobId: string): Promise<Result<AgentJobDetailView>>;
  accept(offerId: string): Promise<Result<AgentJobDetailView>>;
  decline(offerId: string, reasonCode: DeliveryDeclineReason, note?: string): Promise<Result<null>>;
  giveUp(
    jobId: string,
    reasonCode: DeliveryGiveUpReason,
    note: string | undefined,
    version: number,
  ): Promise<Result<null>>;
  pickup(
    jobId: string,
    code: string,
    photoMediaId: string | undefined,
    version: number,
  ): Promise<Result<CodeStepView>>;
  deliver(
    jobId: string,
    code: string,
    photoMediaId: string | undefined,
    version: number,
  ): Promise<Result<CodeStepView>>;
  fail(
    jobId: string,
    reasonCode: DeliveryFailReason,
    note: string | undefined,
    photoMediaId: string | undefined,
    version: number,
  ): Promise<Result<AgentJobDetailView>>;
  /** A property: screens pass it on to `PhotoCapture`; job photos add the job id (the API refuses them without it). */
  uploadPhoto: (file: Blob, purpose: PhotoPurpose, jobId?: string) => Promise<Result<{ mediaId: string }>>;
  saveDocument(kind: AgentDocumentKind, number: string, mediaId: string): Promise<Result<AgentProfileView>>;
  /** Own payouts and delivered jobs (founder ruling 2026-11-26: manual payouts). */
  earnings(): Promise<Result<AgentEarningsView>>;
}

/** Manual payouts (founder ruling 2026-11-26): staff record what they paid; a correction is a reversing row. */
export const PAYOUT_METHODS = AGENT_PAYOUT_METHODS;
export type PayoutMethod = (typeof AGENT_PAYOUT_METHODS)[number];
/** The agent's own payout row (`note` is always null: staff notes stay with staff). */
export type PayoutView = Out<typeof AgentOwnPayoutRow>;
export type AdminPayoutView = Out<typeof AgentPayoutRow>;
export type AdminPayoutPageView = Out<typeof AgentPayoutPage>;
/** `idempotencyKey`: one per form opening, kept across retries (`newPayoutKey` / `nextPayoutKey` in `view.ts`). */
export type PayoutInputView = Out<typeof AgentPayoutInput>;
export type PayoutSummaryRow = Out<typeof AgentPayoutSummary>['items'][number];
export type AgentEarningsView = Out<typeof AgentEarnings>;

export interface ShopDeliveryClient extends Live {
  markReady(orderCode: string, version: number): Promise<Result<null>>;
  returnReceived(orderCode: string, returnCode: string): Promise<Result<null>>;
  confirmSwitch(orderCode: string, id: string, version: number): Promise<Result<null>>;
  declineSwitch(
    orderCode: string,
    id: string,
    reasonCode: DeliverySwitchDeclineReason,
    note: string | undefined,
    version: number,
  ): Promise<Result<null>>;
  modeView(shopId: string): Promise<Result<ShopDeliveryModeViewT>>;
  requestMode(
    shopId: string,
    requestedMode: ShopDeliveryMode,
    reasonCode: ShopModeRequestReason,
    note?: string,
  ): Promise<Result<null>>;
  withdrawMode(shopId: string, id: string): Promise<Result<null>>;
}

export interface AdminDeliveryClient extends Live {
  jobs(view: AdminJobsView, cursor: string | null): Promise<Result<Page<AdminJobRowView>>>;
  job(jobId: string): Promise<Result<AdminJobDetailView>>;
  /** Every job of one sub-order (admin order detail → timeline). */
  jobsForOrder(orderCode: string): Promise<Result<AdminJobDetailView[]>>;
  offer(jobId: string, agentId: string, version: number): Promise<Result<null>>;
  withdraw(jobId: string, reasonCode: DeliveryWithdrawReason, version: number): Promise<Result<null>>;
  failureDecision(
    jobId: string,
    decision: DeliveryFailureDecision,
    agent: DeliveryRetryAgent | undefined,
    version: number,
  ): Promise<Result<null>>;
  override(
    jobId: string,
    kind: 'pickup' | 'delivery' | 'return',
    reason: string,
    version: number,
  ): Promise<Result<null>>;
  switchToShop(orderCode: string, reasonCode: DeliverySwitchReason, note?: string): Promise<Result<null>>;
  /** Not paged (the API answers the whole list for the staff member's cities). */
  agents(): Promise<Result<Page<AdminAgentRowView>>>;
  agent(id: string): Promise<Result<AdminAgentDetailView>>;
  setStatus(
    id: string,
    status: AgentStatus,
    version: number,
    reasonCode?: AgentStatusReason,
    note?: string,
  ): Promise<Result<null>>;
  editVehicle(id: string, vehicleType: AgentVehicleType, version: number): Promise<Result<null>>;
  document(id: string, kind: AgentDocumentKind): Promise<Result<AdminDocumentViewT>>;
  decideDocument(
    id: string,
    kind: AgentDocumentKind,
    verify: boolean,
    reasonCode?: AgentDocumentRejectReason,
  ): Promise<Result<null>>;
  applications(cursor: string | null): Promise<Result<Page<AgentApplicationView>>>;
  rejectApplication(
    code: string,
    reasonCode: ApplicationRejectReason,
    version: number,
    note?: string,
  ): Promise<Result<null>>;
  /** Not paged. */
  invites(): Promise<Result<Page<AgentInviteRowView>>>;
  invite(
    input:
      | { applicationCode: string }
      | { name: string; phone: string; email?: string; cityCode: string; vehicleType: AgentVehicleType },
  ): Promise<Result<{ id: string; token: string; expiresAt: string }>>;
  revokeInvite(id: string): Promise<Result<null>>;
  modeRequests(status: 'pending' | 'all'): Promise<Result<Page<AdminShopModeRequestView>>>;
  decideMode(
    id: string,
    approve: boolean,
    version: number,
    reasonCode?: ShopModeRejectReason,
  ): Promise<Result<null>>;
  payouts(filter: { agentId?: string; from?: string; to?: string }): Promise<Result<AdminPayoutPageView>>;
  recordPayout(input: PayoutInputView): Promise<Result<null>>;
  correctPayout(id: string, note: string): Promise<Result<null>>;
  /** Per agent: delivered jobs in the period and what was already paid for it. */
  payoutSummary(from: string, to: string): Promise<Result<{ items: PayoutSummaryRow[] }>>;
}

/** The staff actions of the typed `delivery_admin_action` event (spec 12, `client-events.ts`). */
export type DeliveryAdminAction = ClientEvents['delivery_admin_action']['action'];
