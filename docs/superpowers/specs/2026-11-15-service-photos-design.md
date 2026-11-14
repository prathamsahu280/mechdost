# Before/after photos for workshop jobs, and the shared photo upload pipeline (design)

Date: 2026-11-15 · Specs: 06, 08 (admin settings), 13 (security), 16 (images) · Decisions: "2026-11-15 — Launch features
round" (photos) and "… second answers" (public by admin setting alone) · Research: security-vulnerabilities.md (uploads,
sharp ≥ 0.35.4, private buckets + signed URLs ≤ 10 min), market-scan § 3

## Intent

Proof of work builds trust for a brand-new platform: the customer sees the vehicle as it came in and as it left. There
is no upload pipeline in the codebase yet, so this design also creates the one product photos will reuse (next tier).

## Goals / non-goals / anti-goals

- Goals: workshops add "before" photos at vehicle received and "after" photos before marking ready; required by default;
  admin settings make them required or optional and public or private; customers and admin see them on the request;
  when public, the workshop profile shows a gallery of after (and before) photos.
- Non-goals: video; automatic number-plate blur (P2, queued); product photos (next tier, reuses the pipeline).
- Anti-goals: location data (EXIF GPS) leaking from phone photos; public buckets; SVG or other active content; huge
  originals served to customers; another user's photos reachable by id.

## Approaches

1. **Upload through the API, processed server-side, stored in a private Supabase Storage bucket (chosen):** the API
   receives the file (multipart, ≤ 8 MB), checks magic bytes (JPEG, PNG, WebP; HEIC converted if sharp supports it,
   else refused with a clear message), uses sharp to auto-rotate, strip all metadata and write two WebP variants
   (1600 px and 480 px), uploads them with the server secret key, and stores a row. Viewing uses signed URLs (≤ 10 min)
   from the API, which checks the viewer's right to see them. Strongest privacy, one place for limits.
2. Direct browser upload with a signed upload URL, processed by a later job: less API load, but originals with EXIF sit
   in storage until processed and the size/type checks are weaker. Not chosen at launch volume.
3. Public bucket: rejected (security research rule).

## Decided

- **Settings** (admin, rule 8): `service.photos_required` (default **true**: "make it required"), `service.photos_public`
  (default **false**; "admin can configure if its required or not and if its public or private"; the user ruled no
  per-request customer OK is needed), `service.photos_max_per_stage` (default 6).
- **Gates:** with photos required, `vehicle_received` needs ≥ 1 before photo and `ready` needs ≥ 1 after photo — the
  repository enforces it in the same transaction as the status change (409 `PHOTOS_REQUIRED`), not only the UI.
- **Data:** `media_objects` (generic: owner kind + id, bucket, path, mime, width, height, bytes, sha256, uploaded_by,
  created_at, deleted_at) + `service_photos` (request_id, stage `before|after`, media_id, caption optional, sort). RLS on,
  revoked from anon/authenticated; soft delete by the workshop before the request is billed; audited.
- **Who sees what:** the request's customer, the workshop's users, staff with `service:read` in the city; public gallery
  only when `photos_public` is on, only after the job is completed, after photos first, max 12 per workshop page,
  newest first. The privacy notice (policy content) gains a line that workshop job photos may be shown on the
  workshop's page when MechDost enables it.
- **Limits:** rate limit per workshop user (30 uploads / 10 min), 8 MB, 6 per stage, sharp pinned ≥ 0.35.4 (pnpm
  `allowBuilds` already lists sharp), no SVG/GIF; storage bucket `service-photos` private; secret key server-only.
- **Web:** workshop job card: "Add before photos" / "Add after photos" (camera on phones via `accept="image/*"
capture`), thumbnails with remove, progress and errors in en + hi; customer request page: before/after strip with a
  viewer; workshop profile gallery (lazy, `next/image` with the signed URL loader or an API image proxy, width/height
  set, no CLS). State-audit rows: 0 / 1 / 6 photos, upload error, required gate message, gallery on/off.
- **Analytics:** `service_photo_added {stage}`, `service_photo_removed {stage}`, `service_photos_viewed`; no paths.

## Left to the builder

Whether the image is served through an API proxy (simplest with `next/image`) or signed URLs; HEIC handling; how the
bucket is created (migration note + runbook step if the Storage API needs the dashboard); exact error codes.
