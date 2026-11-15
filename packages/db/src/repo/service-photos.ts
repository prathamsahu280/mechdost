import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { OPERATIONAL_SETTINGS } from '@mechdost/shared/settings';
import {
  PHOTO_GALLERY_MAX,
  photoRemovable,
  photoStageOpen,
  type PhotoStage,
} from '@mechdost/shared/service-photos';
import type { ServiceRequestStatus } from '@mechdost/shared/state';
import { auditLog, mediaObjects, serviceRequests, servicePhotos, settings } from '../schema';
import { ConflictError, NotFoundError } from './errors';
import { recordServerEvent } from './events';
import type { Tx } from './orders';
import type { CityScope } from './routing';
import { lockRequest, type RequestCore } from './service-requests';
import { rowsOf } from './sql-rows';

/**
 * Before/after photos of a workshop job (spec 06 "Job photos", design 2026-11-15). The repository owns every rule:
 * which statuses accept a stage, the per-stage limit (counted under the request lock, so parallel uploads cannot
 * exceed it), the gates the status moves call, soft delete with an audit row, and who may list what. It never sees
 * file bytes or storage credentials: the API processes and stores the image first and hands over the finished
 * object keys. A photo of another workshop's, customer's or city's request is simply 404.
 */
export interface PhotoSettings {
  required: boolean;
  public: boolean;
  maxPerStage: number;
}

/** The three site-wide photo settings; a stored value outside the registry's type or range reads as the default. */
export async function photoSettings(db: Tx): Promise<PhotoSettings> {
  const keys = ['service.photos_required', 'service.photos_public', 'service.photos_max_per_stage'] as const;
  const rows = await db
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(and(isNull(settings.cityId), inArray(settings.key, [...keys])));
  const value = (key: string): unknown => rows.find((r) => r.key === key)?.value;
  const bool = (key: 'service.photos_required' | 'service.photos_public'): boolean => {
    const v = value(key);
    return typeof v === 'boolean' ? v : OPERATIONAL_SETTINGS[key].default;
  };
  const max = OPERATIONAL_SETTINGS['service.photos_max_per_stage'];
  const m = value('service.photos_max_per_stage');
  return {
    required: bool('service.photos_required'),
    public: bool('service.photos_public'),
    maxPerStage:
      typeof m === 'number' && Number.isInteger(m) && m >= max.min && m <= max.max ? m : max.default,
  };
}

/** The gate of a stage has passed: before from `vehicle_received` on, after from `ready` on. */
const photoGatePassed = (stage: PhotoStage, status: ServiceRequestStatus): boolean =>
  stage === 'before' ? status !== 'confirmed' : status === 'ready';

async function liveCount(tx: Tx, requestId: string, stage: PhotoStage): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(servicePhotos)
    .where(
      and(
        eq(servicePhotos.requestId, requestId),
        eq(servicePhotos.stage, stage),
        isNull(servicePhotos.deletedAt),
      ),
    );
  return row?.n ?? 0;
}

/**
 * The gate the status moves call in their own transaction (hard rule 3): with photos required, `vehicle_received`
 * needs a before photo and `ready` an after photo. 409 `PHOTOS_REQUIRED` otherwise.
 */
export async function assertPhotosFor(tx: Tx, requestId: string, stage: PhotoStage): Promise<void> {
  if (!(await photoSettings(tx)).required) return;
  if ((await liveCount(tx, requestId, stage)) < 1)
    throw new ConflictError(`Add at least one ${stage} photo first`, 'PHOTOS_REQUIRED');
}

interface UploadInput {
  workshopIds: readonly string[];
  code: string;
  stage: PhotoStage;
}

const inWorkshops = (ids: readonly string[]) =>
  ids.length === 0 ? sql`false` : inArray(serviceRequests.workshopId, [...ids]);

/** Status window and limit; called twice (cheap pre-check before the image work, again under the lock). */
async function assertCanAdd(tx: Tx, r: RequestCore, stage: PhotoStage): Promise<number> {
  if (!photoStageOpen(stage, r.status))
    throw new ConflictError('Photos cannot be added at this step', 'PHOTO_STAGE_CLOSED');
  const max = (await photoSettings(tx)).maxPerStage;
  const have = await liveCount(tx, r.id, stage);
  if (have >= max) throw new ConflictError(`You can add up to ${String(max)} photos here`, 'PHOTO_LIMIT');
  return have;
}

/**
 * Before any image work: the request must be this workshop's, the stage open and the limit not reached. Returns the
 * request id and workshop id for the object keys. (The limit is checked again under the lock when the row is saved.)
 */
export async function prepareServicePhoto(
  db: Tx,
  input: UploadInput,
): Promise<{ requestId: string; workshopId: string; max: number }> {
  const [row] = await db
    .select({
      id: serviceRequests.id,
      workshopId: serviceRequests.workshopId,
      status: serviceRequests.status,
    })
    .from(serviceRequests)
    .where(and(eq(serviceRequests.code, input.code), inWorkshops(input.workshopIds)))
    .limit(1);
  if (!row?.workshopId) throw new NotFoundError('Service request not found');
  const status = row.status as ServiceRequestStatus;
  if (!photoStageOpen(input.stage, status))
    throw new ConflictError('Photos cannot be added at this step', 'PHOTO_STAGE_CLOSED');
  const max = (await photoSettings(db)).maxPerStage;
  if ((await liveCount(db, row.id, input.stage)) >= max)
    throw new ConflictError(`You can add up to ${String(max)} photos here`, 'PHOTO_LIMIT');
  return { requestId: row.id, workshopId: row.workshopId, max };
}

export interface StoredImage {
  mediaId: string;
  bucket: string;
  path: string;
  thumbPath: string;
  width: number;
  height: number;
  bytes: number;
  thumbBytes: number;
  sha256: string;
}

export interface PhotoRow {
  id: string;
  stage: PhotoStage;
  caption: string | null;
  mediaId: string;
  width: number;
  height: number;
  createdAt: Date;
}

/** Save the row for an image already stored (status and limit re-checked under the request lock). */
export async function saveServicePhoto(
  db: Tx,
  input: UploadInput & { staffUserId: string; image: StoredImage },
): Promise<PhotoRow> {
  return db.transaction(async (tx) => {
    const r = await lockRequest(
      tx,
      and(eq(serviceRequests.code, input.code), inWorkshops(input.workshopIds)),
    );
    if (!r.workshopId) throw new NotFoundError('Service request not found');
    const have = await assertCanAdd(tx, r, input.stage);
    const img = input.image;
    await tx.insert(mediaObjects).values({
      id: img.mediaId,
      ownerKind: 'service_photo',
      ownerId: r.id,
      bucket: img.bucket,
      path: img.path,
      thumbPath: img.thumbPath,
      width: img.width,
      height: img.height,
      bytes: img.bytes,
      thumbBytes: img.thumbBytes,
      sha256: img.sha256,
      uploadedBy: input.staffUserId,
    });
    const [photo] = await tx
      .insert(servicePhotos)
      .values({
        requestId: r.id,
        stage: input.stage,
        mediaId: img.mediaId,
        sortOrder: have,
        createdBy: input.staffUserId,
      })
      .returning();
    if (!photo) throw new ConflictError('The photo could not be saved', 'PHOTO_NOT_SAVED');
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'workshop',
      action: 'service_photo.add',
      entity: 'service_request',
      entityId: r.id,
      after: { photoId: photo.id, stage: input.stage, bytes: img.bytes },
    });
    await recordServerEvent(tx, 'service_photo_added', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: r.workshopId, stage: input.stage, bytes: img.bytes },
    });
    return {
      id: photo.id,
      stage: input.stage,
      caption: photo.caption,
      mediaId: img.mediaId,
      width: img.width,
      height: img.height,
      createdAt: photo.createdAt,
    };
  });
}

/** Soft delete until the bill (the workshop's own job only); audited, with the request's events untouched. */
export async function removeServicePhoto(
  db: Tx,
  input: { workshopIds: readonly string[]; code: string; photoId: string; staffUserId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const r = await lockRequest(
      tx,
      and(eq(serviceRequests.code, input.code), inWorkshops(input.workshopIds)),
    );
    if (!r.workshopId) throw new NotFoundError('Service request not found');
    const [photo] = await tx
      .select({ id: servicePhotos.id, stage: servicePhotos.stage, mediaId: servicePhotos.mediaId })
      .from(servicePhotos)
      .where(
        and(
          eq(servicePhotos.id, input.photoId),
          eq(servicePhotos.requestId, r.id),
          isNull(servicePhotos.deletedAt),
        ),
      )
      .for('update');
    if (!photo) throw new NotFoundError('Photo not found');
    if (!photoRemovable(r.status))
      throw new ConflictError('Photos cannot be removed after the bill', 'PHOTO_STAGE_CLOSED');
    // Proof stays: once a stage's gate has passed, its last live photo cannot be removed (counted under the lock).
    if (photoGatePassed(photo.stage as PhotoStage, r.status) && (await photoSettings(tx)).required) {
      if ((await liveCount(tx, r.id, photo.stage as PhotoStage)) <= 1)
        throw new ConflictError('The last photo of this stage must stay', 'PHOTO_REQUIRED_KEEP');
    }
    const now = new Date();
    await tx.update(servicePhotos).set({ deletedAt: now }).where(eq(servicePhotos.id, photo.id));
    await tx.update(mediaObjects).set({ deletedAt: now }).where(eq(mediaObjects.id, photo.mediaId));
    await tx.insert(auditLog).values({
      actorUserId: input.staffUserId,
      actorRole: 'workshop',
      action: 'service_photo.remove',
      entity: 'service_request',
      entityId: r.id,
      before: { photoId: photo.id, stage: photo.stage },
    });
    await recordServerEvent(tx, 'service_photo_removed', {
      userId: input.staffUserId,
      cityId: r.cityId,
      props: { requestCode: r.code, workshopId: r.workshopId, stage: photo.stage as PhotoStage },
    });
  });
}

async function photosOf(db: Tx, requestId: string): Promise<PhotoRow[]> {
  const rows = await db
    .select({
      id: servicePhotos.id,
      stage: servicePhotos.stage,
      caption: servicePhotos.caption,
      mediaId: servicePhotos.mediaId,
      width: mediaObjects.width,
      height: mediaObjects.height,
      createdAt: servicePhotos.createdAt,
    })
    .from(servicePhotos)
    .innerJoin(mediaObjects, eq(mediaObjects.id, servicePhotos.mediaId))
    .where(and(eq(servicePhotos.requestId, requestId), isNull(servicePhotos.deletedAt)))
    .orderBy(asc(servicePhotos.stage), asc(servicePhotos.sortOrder), asc(servicePhotos.id));
  return rows.map((r) => ({ ...r, stage: r.stage as PhotoStage }));
}

/** The request's photos for the workshop that owns it (404 for another workshop's code). */
export async function listPhotosForWorkshop(db: Tx, workshopIds: readonly string[], code: string) {
  const [r] = await db
    .select({ id: serviceRequests.id })
    .from(serviceRequests)
    .where(and(eq(serviceRequests.code, code), inWorkshops(workshopIds)))
    .limit(1);
  if (!r) throw new NotFoundError('Service request not found');
  return { photos: await photosOf(db, r.id), settings: await photoSettings(db) };
}

/** The request's photos for its own customer (404 for anyone else's code). */
export async function listPhotosForCustomer(db: Tx, userId: string, code: string) {
  const [r] = await db
    .select({ id: serviceRequests.id })
    .from(serviceRequests)
    .where(and(eq(serviceRequests.code, code), eq(serviceRequests.userId, userId)))
    .limit(1);
  if (!r) throw new NotFoundError('Service request not found');
  return { photos: await photosOf(db, r.id), settings: await photoSettings(db) };
}

/** Staff with service read in the request's city (the caller passes the scope its permission resolves to). */
export async function listPhotosForStaff(db: Tx, scope: CityScope, code: string) {
  const [r] = await db
    .select({ id: serviceRequests.id, cityId: serviceRequests.cityId })
    .from(serviceRequests)
    .where(eq(serviceRequests.code, code))
    .limit(1);
  if (!r || !(scope.all || scope.cityIds.includes(r.cityId)))
    throw new NotFoundError('Service request not found');
  return { photos: await photosOf(db, r.id), settings: await photoSettings(db) };
}

export interface ServedMedia {
  bucket: string;
  path: string;
  thumbPath: string;
  /** Whether the public gallery may show it: setting on, job completed, workshop published and approved. */
  publicNow: boolean;
}

/** The object keys of one live photo for the image endpoint, or null (never reveals why). */
export async function findMediaForServing(db: Tx, mediaId: string): Promise<ServedMedia | null> {
  const [row] = rowsOf<{
    bucket: string;
    path: string;
    thumb_path: string;
    status: string;
    published: boolean | null;
    w_status: string | null;
  }>(
    await db.execute(sql`
      select m.bucket, m.path, m.thumb_path, r.status, w.published, w.status as w_status
      from media_objects m
      join service_photos p on p.media_id = m.id
      join service_requests r on r.id = p.request_id
      left join workshops w on w.id = r.workshop_id
      where m.id = ${mediaId} and m.deleted_at is null and p.deleted_at is null
      limit 1`),
  );
  if (!row) return null;
  const isPublic = (await photoSettings(db)).public;
  return {
    bucket: row.bucket,
    path: row.path,
    thumbPath: row.thumb_path,
    publicNow:
      isPublic && row.status === 'completed' && row.published === true && row.w_status === 'approved',
  };
}

export interface GalleryPhoto {
  id: string;
  mediaId: string;
  stage: PhotoStage;
  width: number;
  height: number;
}

/**
 * The workshop page's gallery: only with the admin setting on, only completed jobs, after photos first, newest job
 * first, at most 12. Off or unknown workshop: `enabled: false` and nothing else.
 */
export async function listWorkshopGallery(
  db: Tx,
  slug: string,
): Promise<{ enabled: boolean; photos: GalleryPhoto[] }> {
  if (!(await photoSettings(db)).public) return { enabled: false, photos: [] };
  const rows = rowsOf<{ id: string; media_id: string; stage: string; width: number; height: number }>(
    await db.execute(sql`
      select p.id, p.media_id, p.stage, m.width, m.height
      from service_photos p
      join media_objects m on m.id = p.media_id
      join service_requests r on r.id = p.request_id
      join workshops w on w.id = r.workshop_id
      where w.slug = ${slug} and w.published and w.status = 'approved'
        and r.status = 'completed' and p.deleted_at is null and m.deleted_at is null
      order by r.completed_at desc nulls last, (p.stage = 'after') desc, p.sort_order, p.id
      limit ${PHOTO_GALLERY_MAX}`),
  );
  return {
    enabled: true,
    photos: rows.map((r) => ({
      id: r.id,
      mediaId: r.media_id,
      stage: r.stage as PhotoStage,
      width: r.width,
      height: r.height,
    })),
  };
}
