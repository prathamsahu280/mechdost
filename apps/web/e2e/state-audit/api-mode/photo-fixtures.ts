/**
 * Typed fixtures of the job photo audit rows (spec 06 "Job photos", design 2026-11-15): the workshop job card's photo
 * section (0 / 1 / 6 photos, an upload the API refuses, the gate message at "vehicle received") and the customer's
 * before/after strip with its viewer. The images are one tiny PNG answered for every `/service-photos/*` request. The
 * workshop profile's gallery is a server-rendered page the browser mock cannot feed (its workshop is fetched on the
 * server), so gallery on/off is covered by the API and repository tests instead. Every body carries its shared schema.
 */
import { ServicePhotosDto, type PhotoStage } from '@mechdost/shared/service-photos';
import { ServiceRequestDetailDto, ServiceRequestPageDto } from '@mechdost/shared/service-api';
import type { AuditCase } from '../cases.ts';
import type { Mock, Reply } from './mock-api.ts';
import { detailOf, roleMock, summaryOf } from './home-fixtures.ts';

type Dto<S extends { parse(value: unknown): unknown }> = ReturnType<S['parse']>;
type Detail = Dto<typeof ServiceRequestDetailDto>;

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
/** A 1x1 PNG: enough for a thumbnail box and the viewer. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const imageMock: Mock = {
  method: 'GET',
  path: /^\/service-photos\//,
  reply: (): Reply => ({ raw: { contentType: 'image/png', base64: PIXEL } }),
};

/** The product page's pictures (`/product-photos/{id}/{width}`): one tiny PNG for every request. */
export function productPhotoMocks(): Mock[] {
  return [
    {
      method: 'GET',
      path: /^\/product-photos\//,
      reply: (): Reply => ({ raw: { contentType: 'image/png', base64: PIXEL } }),
    },
  ];
}

function photos(count: number, stage: PhotoStage, required: boolean): Dto<typeof ServicePhotosDto> {
  return {
    photos: Array.from({ length: count }, (_, i) => ({
      id: uuid(100 + i),
      stage,
      caption: null,
      width: i % 2 === 0 ? 1600 : 1200,
      height: i % 2 === 0 ? 1200 : 1600,
      thumbUrl: `/service-photos/${uuid(200 + i)}/thumb?e=9999999999&s=audit`,
      largeUrl: `/service-photos/${uuid(200 + i)}/large?e=9999999999&s=audit`,
      createdAt: '2026-11-15T09:00:00.000Z',
    })),
    required,
    maxPerStage: 6,
  };
}

/** A workshop-booked job at the given status (the home fixtures' request, switched to the workshop). */
function jobAt(status: 'confirmed' | 'in_progress', c: AuditCase): Detail {
  const d = detailOf('confirmed-code', c);
  return {
    ...d,
    serviceMode: 'workshop',
    home: null,
    status,
    odometerKm: status === 'confirmed' ? null : 21_400,
  };
}

const countOf = (v: string | undefined): number => (v === 'six' ? 6 : v === 'one' ? 1 : 0);

export function workshopPhotoMocks(c: AuditCase): Mock[] {
  const state = c.state.photos ?? 'none';
  const stage: PhotoStage = c.state.stage === 'after' ? 'after' : 'before';
  const detail = jobAt(stage === 'after' ? 'in_progress' : 'confirmed', c);
  const required = c.state.required !== 'off';
  const n = state === 'one' || state === 'six' ? countOf(state) : 0;
  return [
    roleMock(c),
    {
      method: 'GET',
      path: /^\/workshop\/requests$/,
      schema: ServiceRequestPageDto,
      reply: ({ query }): Reply => ({
        body: {
          items: query.get('view') === 'active' ? [summaryOf(detail)] : [],
          nextCursor: null,
        } satisfies Dto<typeof ServiceRequestPageDto>,
      }),
    },
    {
      method: 'GET',
      path: /^\/workshop\/requests\/SR-[^/]+\/photos$/,
      schema: ServicePhotosDto,
      reply: (): Reply => ({ body: photos(n, stage, required) }),
    },
    {
      method: 'POST',
      path: /^\/workshop\/requests\/SR-[^/]+\/photos$/,
      reply: (): Reply => ({ status: 422, code: 'PHOTO_TYPE' }),
    },
    {
      method: 'POST',
      path: /^\/workshop\/requests\/SR-[^/]+\/vehicle-received$/,
      reply: (): Reply => ({ status: 409, code: 'PHOTOS_REQUIRED' }),
    },
    {
      method: 'GET',
      path: /^\/workshop\/requests\/SR-[^/]+$/,
      schema: ServiceRequestDetailDto,
      reply: (): Reply => ({ body: detail }),
    },
    imageMock,
  ];
}

export function customerPhotoMocks(c: AuditCase): Mock[] {
  const detail = jobAt('in_progress', c);
  const n = countOf(c.state.photos);
  const both = (count: number): Dto<typeof ServicePhotosDto> => {
    const before = photos(Math.ceil(count / 2), 'before', true).photos;
    const after = photos(Math.floor(count / 2), 'after', true).photos.map((p, i) => ({
      ...p,
      id: uuid(300 + i),
    }));
    return { photos: [...before, ...after], required: true, maxPerStage: 6 };
  };
  return [
    roleMock(c),
    {
      method: 'GET',
      path: /^\/service-requests\/SR-[^/]+\/photos$/,
      schema: ServicePhotosDto,
      reply: (): Reply => ({ body: both(n) }),
    },
    {
      method: 'GET',
      path: /^\/service-requests\/SR-[^/]+$/,
      schema: ServiceRequestDetailDto,
      reply: (): Reply => ({ body: detail }),
    },
    imageMock,
  ];
}
