# Job photos (runbook)

Before/after photos of workshop jobs (spec 06 "Built: job photos"; security spec 13 "Uploads"). Pictures live in the private Supabase Storage bucket `service-photos`; the browser never gets a Storage address.

## 1. One-time setup

1. Make sure the API's server has `SUPABASE_URL` (the project URL, `https://<ref>.supabase.co`) and `SUPABASE_SECRET_KEY` (a **secret** key `sb_secret_…`, never the publishable key and never a `NEXT_PUBLIC_` variable). They are already in `.env.example` and `deploy/env.server.example`. Redeploy after setting them (`docs/runbooks/deploy.md`).
2. **The bucket is created by the API on start** (idempotent). The API log shows `photo_bucket_failed` if it could not, or if the bucket exists but is **public** (it refuses to use a public bucket). Manual fallback: Supabase dashboard → Storage → New bucket → name `service-photos`, **Public bucket off**, file size limit 8 MB, allowed MIME types `image/webp`.
3. Without the two variables the API logs `photos_disabled` and every photo route answers `503 PHOTOS_UNAVAILABLE`; the rest of the site works.

## 2. First live check (once, after the first deploy with the keys)

The Storage REST calls use the new-style secret key in the `apikey` header only (a legacy `service_role` JWT also gets `Authorization: Bearer`). This was written against the documented API and tested only with a fake transport, so verify once:

1. In Admin → Settings leave "Workshops must add before and after photos" on.
2. As a workshop owner open a confirmed job (Partner → Workshop), tap "Add before photos", pick a JPG. A thumbnail should appear.
3. If you get "Photos are not available right now": read the API log for `photo_storage_failed` (the message names the HTTP status, never the key). 401/403 means the key or header form is wrong: try a legacy `service_role` key, or tell the builder.
4. As the customer open the request: the before/after strip shows the photo.

## 3. How pictures are served

- Listings (`GET …/photos`) are rights-checked and carry two URLs per photo (480 px and 1600 px WebP) valid for 10 minutes, signed with an HMAC derived from the data keyring (`DATA_INDEX_KEY`). Rotating `DATA_INDEX_KEY` invalidates outstanding URLs only (pages reload them).
- The image route `GET /v1/service-photos/{id}/{thumb|large}` checks the signature on every read; a public-gallery photo needs no signature but is re-checked (setting on, job completed, workshop published and approved). Anything else is 404.
- Admin → Settings: "Show completed jobs' photos on the workshop page" turns the public gallery on or off; off hides pictures at once (browsers may keep a copy up to 5 minutes).

## 4. Limits

8 MB per file (413 `PHOTO_TOO_LARGE`), JPEG/PNG/WebP only (HEIC refused with a "please upload JPG or PNG" message), 50 megapixels, 6 per stage by default (setting), 30 uploads per 10 minutes per workshop user. EXIF and all other metadata are removed; the original is never stored.

## 5. Orphans and deletion

A removed photo is soft-deleted (row and audit entry kept; the object stays in the bucket). If the API dies between uploading the object and saving the row, an unreachable object stays too (random key, no row). A purge job is a pending decision (decisions.md #20). To inspect: Storage → `service-photos` → `job/<request id>/`.

## 6. Troubleshooting

| Symptom                               | Check                                                                                                 |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Every upload 503                      | `photos_disabled` or `photo_storage_failed` in the API log; the two variables; bucket exists, private |
| Upload 422 `PHOTO_HEIC`               | the file really is HEIC (iPhone Camera → Formats → Most Compatible, or share as JPG)                  |
| Image shows a broken icon on a page   | CSP `img-src` must include the API origin (`NEXT_PUBLIC_API_URL`); URL older than 10 minutes → reload |
| "Add at least one before photo" (409) | the setting is on and the job has none; add one, or turn the setting off for everyone                 |
