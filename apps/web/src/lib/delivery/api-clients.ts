import {
  AdminAgentDetail,
  AdminAgentPage,
  AdminDocumentView,
  AdminJobDetail,
  AdminJobPage,
  AdminShopModeRequestPage,
  AgentInviteCreated,
  AgentInvitePage,
  AgentJobDetail,
  AgentJobPage,
  AgentPhotoUploaded,
  AgentProfile,
  CodeStepResult,
  DeliverySwitchRow,
  ShopDeliveryModeView,
} from '@mechdost/shared/delivery/api';
import { adminApi, type ResponseSchema } from '../admin-api';
import type {
  AdminDeliveryClient,
  AgentApplicationView,
  AgentClient,
  Page,
  Result,
  ShopDeliveryClient,
} from './types';

/**
 * The delivery-agent clients on the API (spec 24 route table; real sign-in builds only). Loaded with `import()` by
 * `use-delivery-client.ts`, so the Zod DTOs never reach a demo or storefront bundle. Every answer is checked against
 * the shared schema before use (hard rule 4); errors come back as the API's code for the screen to translate.
 */

/** 204 answers carry no body: anything parses to null. */
const Empty: ResponseSchema<null> = { safeParse: () => ({ success: true, data: null }) };
const qs = (o: Record<string, string | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : '';
};
const enc = encodeURIComponent;

export function apiAgentClient(locale: string): AgentClient {
  const get = <T>(path: string, schema: ResponseSchema<T>) => adminApi(locale, path, schema);
  const post = <T>(path: string, schema: ResponseSchema<T>, body: unknown = {}) =>
    adminApi(locale, path, schema, { method: 'POST', body });
  return {
    sample: false,
    me: () => get('/agent/me', AgentProfile),
    setOnline: (online, version) => post('/agent/me/online', AgentProfile, { online, version }),
    jobs: (view, cursor) => get(`/agent/jobs${qs({ view, cursor })}`, AgentJobPage),
    job: (jobId) => get(`/agent/jobs/${enc(jobId)}`, AgentJobDetail),
    accept: (offerId) => post(`/agent/offers/${enc(offerId)}/accept`, AgentJobDetail),
    decline: (offerId, reasonCode, note) =>
      post(`/agent/offers/${enc(offerId)}/decline`, Empty, note ? { reasonCode, note } : { reasonCode }),
    giveUp: (jobId, reasonCode, note, version) =>
      post(`/agent/jobs/${enc(jobId)}/give-up`, Empty, { reasonCode, ...(note ? { note } : {}), version }),
    pickup: (jobId, pickupCode, photoMediaId, version) =>
      post(`/agent/jobs/${enc(jobId)}/pickup`, CodeStepResult, {
        pickupCode,
        ...(photoMediaId ? { photoMediaId } : {}),
        version,
      }),
    deliver: (jobId, deliveryCode, photoMediaId, version) =>
      post(`/agent/jobs/${enc(jobId)}/deliver`, CodeStepResult, {
        deliveryCode,
        ...(photoMediaId ? { photoMediaId } : {}),
        version,
      }),
    fail: (jobId, reasonCode, note, photoMediaId, version) =>
      post(`/agent/jobs/${enc(jobId)}/fail`, AgentJobDetail, {
        reasonCode,
        ...(note ? { note } : {}),
        ...(photoMediaId ? { photoMediaId } : {}),
        version,
      }),
    uploadPhoto: (file, purpose) => uploadAgentPhoto(locale, file, purpose),
    saveDocument: (kind, number, mediaId) =>
      adminApi(locale, '/agent/me/documents', AgentProfile, {
        method: 'PUT',
        body: { kind, number, mediaId },
      }),
  };
}

/** `POST /v1/agent/photos` is multipart (`file` + `purpose`); `adminApi` sends JSON, so this one is a plain fetch. */
async function uploadAgentPhoto(
  locale: string,
  file: Blob,
  purpose: string,
): Promise<Result<{ mediaId: string }>> {
  const API = (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/$/, '');
  if (!API) return { ok: false, status: 0, code: 'UNAVAILABLE' };
  const { currentIdToken } = await import('../auth/firebase-client');
  const idToken = await currentIdToken(locale);
  if (!idToken) return { ok: false, status: 401, code: 'AUTH_REQUIRED' };
  const form = new FormData();
  form.set('file', file, file.type === 'image/webp' ? 'photo.webp' : 'photo.jpg');
  form.set('purpose', purpose);
  let res: Response;
  try {
    res = await fetch(`${API}/v1/agent/photos`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${idToken}` },
      body: form,
      cache: 'no-store',
    });
  } catch {
    return { ok: false, status: 0, code: 'NETWORK' };
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      typeof body === 'object' && body !== null && 'error' in body
        ? (body as { error?: { code?: unknown } }).error?.code
        : null;
    return {
      ok: false,
      status: res.status,
      code: typeof code === 'string' ? code : `HTTP_${String(res.status)}`,
    };
  }
  const parsed = AgentPhotoUploaded.safeParse(body);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, status: res.status, code: 'BAD_RESPONSE' };
}

export function apiShopDeliveryClient(locale: string): ShopDeliveryClient {
  const post = <T>(path: string, schema: ResponseSchema<T>, body: unknown = {}) =>
    adminApi(locale, path, schema, { method: 'POST', body });
  const ok = <T>(r: Result<T>): Result<null> => (r.ok ? { ok: true, data: null } : r);
  return {
    sample: false,
    markReady: async (code, version) =>
      ok(await post(`/shop/orders/${enc(code)}/advance`, Empty, { to: 'ready_for_pickup', version })),
    returnReceived: (code, returnCode) =>
      post(`/shop/orders/${enc(code)}/return-received`, Empty, { returnCode }),
    confirmSwitch: (code, id, version) =>
      post(`/shop/orders/${enc(code)}/delivery-switch/${enc(id)}/confirm`, Empty, { version }),
    declineSwitch: (code, id, reasonCode, note, version) =>
      post(`/shop/orders/${enc(code)}/delivery-switch/${enc(id)}/decline`, Empty, {
        reasonCode,
        ...(note ? { note } : {}),
        version,
      }),
    modeView: (shopId) => adminApi(locale, `/shop/delivery-mode/${enc(shopId)}`, ShopDeliveryModeView),
    requestMode: async (shopId, requestedMode, reasonCode, note) =>
      ok(
        await post(`/shop/delivery-mode/${enc(shopId)}/requests`, Empty, {
          requestedMode,
          reasonCode,
          ...(note ? { note } : {}),
        }),
      ),
    withdrawMode: (shopId, id) =>
      post(`/shop/delivery-mode/${enc(shopId)}/requests/${enc(id)}/withdraw`, Empty),
  };
}

// Delivery-agent applications are partner applications of kind `delivery_agent`; the shared `ApplicationPage` row
// requires a PIN code those rows do not have, so the list is read with this tolerant guard (report: contract gap).
type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null;
const strOrNull = (v: unknown) => (typeof v === 'string' ? v : null);
const AppPage: ResponseSchema<Page<AgentApplicationView>> = {
  safeParse: (v) => {
    if (!isRec(v) || !Array.isArray(v.items)) return { success: false };
    const items: AgentApplicationView[] = [];
    for (const r of v.items) {
      if (
        !isRec(r) ||
        typeof r.code !== 'string' ||
        typeof r.name !== 'string' ||
        typeof r.status !== 'string'
      )
        return { success: false };
      items.push({
        code: r.code,
        name: r.name,
        status: r.status,
        vehicleType: (strOrNull(r.vehicleType) as AgentApplicationView['vehicleType']) ?? null,
        cityCode: strOrNull(r.cityCode),
        createdAt: typeof r.createdAt === 'string' ? r.createdAt : '',
      });
    }
    return { success: true, data: { items, nextCursor: strOrNull(v.nextCursor) } };
  },
};
const VersionOnly: ResponseSchema<{ version: number }> = {
  safeParse: (v) =>
    isRec(v) && typeof v.version === 'number'
      ? { success: true, data: { version: v.version } }
      : { success: false },
};
const JobList: ResponseSchema<{ items: { jobId: string }[] }> = {
  safeParse: (v) => {
    const page = AdminJobPage.safeParse(v);
    return page.success ? { success: true, data: page.data } : { success: false };
  },
};

export function apiAdminDeliveryClient(locale: string): AdminDeliveryClient {
  const get = <T>(path: string, schema: ResponseSchema<T>) => adminApi(locale, path, schema);
  const post = <T>(path: string, schema: ResponseSchema<T>, body: unknown = {}) =>
    adminApi(locale, path, schema, { method: 'POST', body });
  return {
    sample: false,
    jobs: (view, cursor) => get(`/admin/delivery/jobs${qs({ view, cursor })}`, AdminJobPage),
    job: (jobId) => get(`/admin/delivery/jobs/${enc(jobId)}`, AdminJobDetail),
    // No route lists the jobs of one order yet: the jobs list filtered by `orderCode` (report: contract gap).
    jobsForOrder: async (orderCode) => {
      const list = await get(`/admin/delivery/jobs${qs({ view: 'all', orderCode })}`, JobList);
      if (!list.ok) return list;
      const details = await Promise.all(
        list.data.items.map((j) => get(`/admin/delivery/jobs/${enc(j.jobId)}`, AdminJobDetail)),
      );
      const out = [];
      for (const d of details) if (d.ok) out.push(d.data);
      return { ok: true, data: out };
    },
    offer: (jobId, agentId, version) =>
      post(`/admin/delivery/jobs/${enc(jobId)}/offer`, Empty, { agentId, version }),
    withdraw: (jobId, reasonCode, version) =>
      post(`/admin/delivery/jobs/${enc(jobId)}/withdraw`, Empty, { reasonCode, version }),
    failureDecision: (jobId, decision, agent, version) =>
      post(`/admin/delivery/jobs/${enc(jobId)}/failure-decision`, Empty, {
        decision,
        ...(agent ? { agent } : {}),
        version,
      }),
    override: (jobId, kind, reason, version) =>
      post(`/admin/delivery/jobs/${enc(jobId)}/override-${kind}`, Empty, { reason, version }),
    switchToShop: async (orderCode, reasonCode, note) => {
      const r = await post(`/admin/orders/${enc(orderCode)}/delivery-switch`, DeliverySwitchRow, {
        reasonCode,
        ...(note ? { note } : {}),
      });
      return r.ok ? { ok: true, data: null } : r;
    },
    agents: (cursor) => get(`/admin/delivery/agents${qs({ cursor })}`, AdminAgentPage),
    agent: (id) => get(`/admin/delivery/agents/${enc(id)}`, AdminAgentDetail),
    setStatus: (id, status, version, reasonCode, note) =>
      post(`/admin/delivery/agents/${enc(id)}/status`, Empty, {
        status,
        version,
        ...(reasonCode ? { reasonCode } : {}),
        ...(note ? { note } : {}),
      }),
    editVehicle: (id, vehicleType, version) =>
      adminApi(locale, `/admin/delivery/agents/${enc(id)}`, Empty, {
        method: 'PATCH',
        body: { vehicleType, version },
      }),
    document: (id, kind) => get(`/admin/delivery/agents/${enc(id)}/documents/${kind}`, AdminDocumentView),
    decideDocument: (id, kind, verify, reasonCode) =>
      post(`/admin/delivery/agents/${enc(id)}/documents/${kind}/${verify ? 'verify' : 'reject'}`, Empty, {
        ...(reasonCode ? { reasonCode } : {}),
      }),
    applications: (cursor) => get(`/admin/delivery/applications${qs({ cursor })}`, AppPage),
    rejectApplication: async (code, reasonCode) => {
      const detail = await get(`/admin/partner-applications/${enc(code)}`, VersionOnly);
      if (!detail.ok) return detail;
      return post(`/admin/partner-applications/${enc(code)}/reject`, Empty, {
        version: detail.data.version,
        reasonCode,
      });
    },
    invites: (cursor) => get(`/admin/delivery/invites${qs({ cursor })}`, AgentInvitePage),
    invite: (input) => post('/admin/delivery/invites', AgentInviteCreated, input),
    revokeInvite: (id) => post(`/admin/delivery/invites/${enc(id)}/revoke`, Empty),
    modeRequests: (status) =>
      get(
        `/admin/delivery/shop-mode-requests${qs({ status: status === 'all' ? null : status })}`,
        AdminShopModeRequestPage,
      ),
    decideMode: (id, approve, version, reasonCode) =>
      post(`/admin/delivery/shop-mode-requests/${enc(id)}/${approve ? 'approve' : 'reject'}`, Empty, {
        version,
        ...(reasonCode ? { reasonCode } : {}),
      }),
  };
}
