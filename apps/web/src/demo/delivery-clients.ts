/**
 * The delivery-agent clients on the browser demo store (spec 24): same interfaces as the API clients
 * (`lib/delivery/api-clients.ts`), so the screens are the same in both builds. Loaded with `import()` only.
 */
import type {
  AdminDeliveryClient,
  AdminJobDetailView,
  AgentClient,
  AgentProfileView,
  Result,
  ShopDeliveryClient,
} from '@/lib/delivery/types';
import * as d from './delivery-store';
import { localizeShop } from './i18n/localize';
import { findShop } from './shops';

const done = <T>(r: d.Res<T>): Result<T> => (r.ok ? r : { ok: false, status: 409, code: r.code });
const nf = { ok: false as const, status: 404, code: 'NOT_FOUND' };
const page = <T>(items: T[]) => ({ ok: true as const, data: { items, nextCursor: null } });

export function demoAgentClient(accountId: string, locale: string): AgentClient {
  const agentId = () => d.agentForAccount(accountId)?.id ?? '';
  const me = (): Result<AgentProfileView> => {
    d.sweepExpiredOffers();
    const p = d.agentProfile(agentId());
    return p ? { ok: true, data: p } : nf;
  };
  const detail = (jobId: string) => {
    const j = d.agentJobDetail(agentId(), jobId, locale);
    return j ? { ok: true as const, data: j } : nf;
  };
  const step = (
    r: d.CodeStep,
  ): Result<{ ok: boolean; attemptsLeft: number; locked: boolean; status: d.DemoJob['status'] }> =>
    'status' in r
      ? { ok: true, data: { ok: r.ok, attemptsLeft: r.attemptsLeft, locked: r.locked, status: r.status } }
      : { ok: false, status: 409, code: r.code };
  return {
    sample: true,
    subscribe: d.subscribeDelivery,
    me: () => Promise.resolve(me()),
    setOnline: (online, version) => {
      const r = d.setOnline(agentId(), online, version);
      return Promise.resolve(r.ok ? me() : done(r));
    },
    jobs: (view) => {
      d.sweepExpiredOffers();
      return Promise.resolve(page(d.agentJobs(agentId(), view)));
    },
    job: (jobId) => {
      d.sweepExpiredOffers();
      return Promise.resolve(detail(jobId));
    },
    accept: (offerId) => {
      const r = d.acceptOffer(agentId(), offerId);
      return Promise.resolve(r.ok ? detail(r.data.jobId) : done(r));
    },
    decline: (offerId, reason, note) =>
      Promise.resolve(done(d.declineOffer(agentId(), offerId, reason, note))),
    giveUp: (jobId, reason, note, version) =>
      Promise.resolve(done(d.giveUpJob(agentId(), jobId, reason, note, version))),
    pickup: (jobId, code, photo, version) =>
      Promise.resolve(step(d.pickupJob(agentId(), jobId, code, photo ?? null, version))),
    deliver: (jobId, code, photo, version) =>
      Promise.resolve(step(d.deliverJob(agentId(), jobId, code, photo ?? null, version))),
    fail: (jobId, reason, note, photo, version) => {
      const r = d.failJob(agentId(), jobId, reason, note, photo ?? null, version);
      return Promise.resolve(r.ok ? detail(jobId) : done(r));
    },
    // Photos are never kept in the browser demo: the id only marks that one was taken.
    uploadPhoto: () => Promise.resolve({ ok: true, data: { mediaId: globalThis.crypto.randomUUID() } }),
    saveDocument: (kind, number) => {
      const r = d.saveAgentDocument(agentId(), kind, number);
      return Promise.resolve(r.ok ? me() : done(r));
    },
  };
}

export function demoShopDeliveryClient(shopSlug: string): ShopDeliveryClient {
  return {
    sample: true,
    subscribe: d.subscribeDelivery,
    markReady: (code) => Promise.resolve(done(d.markReadyForPickup(code, shopSlug))),
    returnReceived: (code, returnCode) => {
      const r = d.returnReceived(code, shopSlug, returnCode);
      if (r.ok) return Promise.resolve({ ok: true, data: null });
      return Promise.resolve({
        ok: false,
        status: 409,
        code: 'attemptsLeft' in r ? `${r.code}:${String(r.attemptsLeft)}` : r.code,
      });
    },
    confirmSwitch: (code, id, version) => Promise.resolve(done(d.confirmSwitch(code, shopSlug, id, version))),
    declineSwitch: (code, id, reason, note, version) =>
      Promise.resolve(done(d.declineSwitch(code, shopSlug, id, reason, note, version))),
    modeView: (shopId) => Promise.resolve({ ok: true, data: d.shopModeView(shopId) }),
    requestMode: (shopId, mode, reason, note) =>
      Promise.resolve(done(d.requestShopMode(shopId, mode, reason, note))),
    withdrawMode: (shopId, id) => Promise.resolve(done(d.withdrawShopModeRequest(shopId, id))),
  };
}

export function demoAdminDeliveryClient(locale: string): AdminDeliveryClient {
  const job = (id: string): Result<AdminJobDetailView> => {
    const j = d.adminJob(id, locale);
    return j ? { ok: true, data: j } : nf;
  };
  return {
    sample: true,
    subscribe: d.subscribeDelivery,
    jobs: (view) => {
      d.sweepExpiredOffers();
      return Promise.resolve(page(d.adminJobs(view, locale)));
    },
    job: (id) => {
      d.sweepExpiredOffers();
      return Promise.resolve(job(id));
    },
    jobsForOrder: (orderCode) => Promise.resolve({ ok: true, data: d.adminJobsForOrder(orderCode, locale) }),
    offer: (jobId, agentId, version) => Promise.resolve(done(d.offerJob(jobId, agentId, version))),
    withdraw: (jobId, reason, version) => Promise.resolve(done(d.withdrawJob(jobId, reason, version))),
    failureDecision: (jobId, decision, agent, version) =>
      Promise.resolve(done(d.decideFailure(jobId, decision, agent, version))),
    override: (jobId, kind, reason, version) =>
      Promise.resolve(done(d.overrideJob(jobId, kind, reason, version))),
    switchToShop: (code, reason, note) => Promise.resolve(done(d.requestSwitch(code, reason, note))),
    agents: () => Promise.resolve(page(d.adminAgents())),
    agent: (id) => {
      const a = d.adminAgent(id);
      return Promise.resolve(a ? { ok: true, data: a } : nf);
    },
    setStatus: (id, status, version, reason, note) =>
      Promise.resolve(done(d.setAgentStatus(id, status, version, reason, note))),
    editVehicle: (id, vehicle, version) => Promise.resolve(done(d.editAgentVehicle(id, vehicle, version))),
    document: (id, kind) => {
      const doc = d.adminDocument(id, kind);
      return Promise.resolve(doc ? { ok: true, data: doc } : nf);
    },
    decideDocument: (id, kind, verify, reason) =>
      Promise.resolve(done(d.decideDocument(id, kind, verify, reason))),
    applications: () =>
      Promise.resolve(
        page(
          d.agentApplications().map((a) => ({
            code: a.code,
            name: a.name,
            vehicleType: a.vehicleType,
            cityCode: a.cityCode,
            status: a.status,
            createdAt: a.createdAt,
          })),
        ),
      ),
    rejectApplication: (code, reason) => Promise.resolve(done(d.rejectAgentApplication(code, reason))),
    invites: () =>
      Promise.resolve(
        page(
          d.agentInvites().map((i) => ({
            id: i.id,
            name: i.name,
            phoneLast4: i.phone.slice(-4),
            hasEmail: i.email !== null,
            cityCode: i.cityCode,
            vehicleType: i.vehicleType,
            status: i.status,
            expiresAt: i.expiresAt,
            createdAt: i.createdAt,
          })),
        ),
      ),
    invite: (input) => Promise.resolve(done(d.inviteAgent(input))),
    revokeInvite: (id) => Promise.resolve(done(d.revokeInvite(id))),
    modeRequests: (status) =>
      Promise.resolve(
        page(
          d
            .shopModeRequests()
            .filter((r) => status === 'all' || r.status === 'pending')
            .map((r) => {
              const shop = findShop(r.shopSlug);
              const shopName = shop ? localizeShop(shop, locale).name : r.shopSlug;
              return { ...r, shopId: r.shopSlug, shopName, cityCode: 'RPR' };
            }),
        ),
      ),
    decideMode: (id, approve, version, reason) =>
      Promise.resolve(done(d.decideShopMode(id, approve, version, reason))),
  };
}
