/**
 * Types of the delivery-agent screens (spec 24), taken from the shared contract (`@mechdost/shared/delivery/api`) with
 * type-only imports: nothing of Zod reaches a page bundle from here. The clients (`agent-client.ts`,
 * `shop-client.ts`, `admin-client.ts`) implement these against the API; `demo/delivery-clients.ts` against the
 * browser demo store. One set of screens serves both (like the Ustaad messages seam).
 */
import type {
  AdminAgentDetail,
  AdminAgentRow,
  AdminDocumentView,
  AdminJobDetail,
  AdminJobRow,
  AdminShopModeRequestRow,
  AgentInvitePreview,
  AgentInviteRow,
  AgentJobCard,
  AgentJobDetail,
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
  DeliveryWithdrawReason,
  ShopDeliveryMode,
  ShopModeRejectReason,
  ShopModeRequestReason,
} from '@mechdost/shared/delivery/codes';

/** The parsed output of a shared schema, without importing Zod. */
type Out<S> = S extends { parse(data: unknown, ...rest: never[]): infer O } ? O : never;

/**
 * Rider rating (founder ruling 2026-11-26): 1–5 stars and quick reasons, one per job, editable for 24 h. The contract
 * DTOs come in a later backend commit; the web builds against this shape meanwhile (report: contract gap).
 */
export const RATING_REASONS = ['on_time', 'polite', 'careful', 'late', 'rude', 'damaged', 'other'] as const;
export type RatingReason = (typeof RATING_REASONS)[number];
export interface DeliveryRating {
  stars: number;
  reasons: RatingReason[];
  note: string | null;
  editableUntil: string;
}

export type AgentProfileView = Out<typeof AgentProfile> & { rating?: number | null };
export type AgentJobCardView = Out<typeof AgentJobCard>;
export type AgentJobDetailView = Out<typeof AgentJobDetail>;
export type CodeStepView = Out<typeof CodeStepResult>;
export type ShopOrderDeliveryView = Out<typeof ShopOrderDelivery>;
export type ShopDeliveryModeViewT = Out<typeof ShopDeliveryModeView>;
export type CustomerDeliveryView = Out<typeof CustomerDeliveryBlock> & {
  /** After a return to the shop: what the refund covers (Lead's call 13). */
  refund?: 'full' | 'parts_only' | null;
  rating?: DeliveryRating | null;
  canRate?: boolean;
};
export type AdminJobRowView = Out<typeof AdminJobRow>;
export type AdminJobDetailView = Out<typeof AdminJobDetail> & {
  pickupLocked?: boolean;
  deliveryLocked?: boolean;
  retryAllowed?: boolean;
};
export type AdminAgentRowView = Out<typeof AdminAgentRow> & {
  ratingAvg?: number | null;
  ratingCount?: number;
};
export type AdminAgentDetailView = Out<typeof AdminAgentDetail> & {
  ratingAvg?: number | null;
  ratingCount?: number;
};
export type AdminDocumentViewT = Out<typeof AdminDocumentView>;
export type AdminShopModeRequestView = Out<typeof AdminShopModeRequestRow>;
export type AgentInviteRowView = Out<typeof AgentInviteRow>;
export type AgentInvitePreviewView = Out<typeof AgentInvitePreview>;

/** A delivery-agent application as the admin list needs it (the API serves partner applications of kind `delivery_agent`). */
export interface AgentApplicationView {
  code: string;
  name: string;
  vehicleType: AgentVehicleType | null;
  cityCode: string | null;
  status: string;
  createdAt: string;
}

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
  /** A property, not a method: screens pass it on as `upload={client.uploadPhoto}`. */
  uploadPhoto: (file: Blob, purpose: PhotoPurpose) => Promise<Result<{ mediaId: string }>>;
  saveDocument(kind: AgentDocumentKind, number: string, mediaId: string): Promise<Result<AgentProfileView>>;
}

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
  agents(cursor: string | null): Promise<Result<Page<AdminAgentRowView>>>;
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
  rejectApplication(code: string, reasonCode: string): Promise<Result<null>>;
  invites(cursor: string | null): Promise<Result<Page<AgentInviteRowView>>>;
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
}
