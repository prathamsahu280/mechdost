/**
 * Typed fixtures of the roadside assistance screens (spec 22, 2026-11-24). The screens read the API through
 * `roadsideCall`, which trusts the answer for its shape only (`@/lib/roadside`), so the fixtures are typed with the
 * screens' own interfaces (`satisfies`): a drifting field fails the type check instead of the page.
 *
 * - `roadsideQuietMocks`: the workshop portal's roadside panel (`GET /workshop/roadside`), the admin dispatch queue
 *   and the admin settings card answer "nothing waiting". They sit under every workshop-portal and admin row, because
 *   the panel loads with the page it belongs to (an unmocked call fails the case, as a missing mock should).
 * - `roadsideTrackMocks`: the customer's tracking page of one request (`RSA-TRACK`): a billed request with the
 *   responder, the arrival code, a two-line bill, the advance already paid and one refund in progress.
 */
import { defaultRsaSettings, type RsaSettings } from '@mechdost/shared/rsa';
import type { RoadsideQueueItem, RoadsideView, RoadsideWorkshopOverview } from '../../../src/lib/roadside.ts';
import type { Mock, Reply } from './mock-api.ts';

const objectBody = {
  parse(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) throw new Error('roadside fixture is not an object');
    return value;
  },
};

export function roadsideQuietMocks(): Mock[] {
  return [
    {
      method: 'GET',
      path: /^\/workshop\/roadside$/,
      schema: objectBody,
      reply: (): Reply => ({
        body: { offers: [], jobs: [], optIns: [] } satisfies RoadsideWorkshopOverview,
      }),
    },
    {
      method: 'GET',
      path: /^\/admin\/roadside\/queue$/,
      schema: objectBody,
      reply: (): Reply => ({ body: [] satisfies RoadsideQueueItem[] }),
    },
    {
      method: 'GET',
      path: /^\/admin\/roadside\/settings$/,
      schema: objectBody,
      reply: (): Reply => ({ body: defaultRsaSettings() satisfies RsaSettings }),
    },
  ];
}

export function roadsideTrackMocks(): Mock[] {
  return [
    {
      method: 'GET',
      path: /^\/roadside\/requests\/[^/]+$/,
      schema: objectBody,
      reply: (ctx): Reply => ({
        body: {
          code: ctx.path.split('/').pop() ?? 'RSA-RPR-2026-DEMO10',
          status: 'billed',
          version: 6,
          vehicleType: '2W',
          problemType: 'flat_tyre',
          pincode: '492001',
          advancePaise: 50_000,
          advancePaid: true,
          cancelReason: null,
          responder: { workshopName: 'Raipur Auto Care', workshopNameHi: 'रायपुर ऑटो केयर' },
          arrivalCode: '4821',
          bill: {
            lines: [
              {
                kind: 'labour',
                description: 'Puncture repair',
                quantity: 1,
                unitPricePaise: 30_000,
                totalPaise: 30_000,
              },
              { kind: 'part', description: 'Tube', quantity: 1, unitPricePaise: 45_000, totalPaise: 45_000 },
            ],
            totalPaise: 75_000,
            advancePaise: 50_000,
            balancePaise: 25_000,
            overpaidPaise: 0,
            balanceMethod: null,
          },
          disputeOpen: false,
          disputeAvailable: true,
          timeline: [
            { status: 'requested', at: '2026-11-24T05:00:00.000Z' },
            { status: 'accepted', at: '2026-11-24T05:03:00.000Z' },
            { status: 'billed', at: '2026-11-24T05:50:00.000Z' },
          ],
          refunds: [{ amountPaise: 10_000, stage: 'processing' }],
        } satisfies RoadsideView,
      }),
    },
  ];
}
