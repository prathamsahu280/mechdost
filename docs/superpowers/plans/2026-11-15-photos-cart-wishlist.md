# Product photos, server cart, wishlist — implementation plan

> For agentic workers: use superpowers:executing-plans; steps are checkboxes.

**Goal:** items 1, 3, 5 of the catalogue/storefront next tier (design `docs/superpowers/specs/2026-11-15-catalogue-storefront-next-tier-design.md`).

**Architecture:** one migration (`0067_photos_cart_wishlist`): `product_photos` extended in place (it was never written), `carts`, `cart_items`, `wishlist_items`, `media_objects.owner_kind` gains `product_photo`. Three repos (`product-photos`, `cart`, `wishlist`), three API route modules, small web pieces: server-rendered `ProductPhoto` through `getImageProps` (no client JS), lazy wishlist heart, lazy cart sync, account Wishlist section, admin photo editor and queue.

**Spec:** the design above, specs 02, 03, 01, 12, 13, 14, 16.

## Global constraints

- Max 8 photos per product, explicit `sort` 0..7, uuid v7 ids, alt en + hi required, variants 320/640/1600 WebP + LQIP.
- Setting `catalogue.shop_photo_uploads` default off; shop photos `pending` until staff approve.
- Public photo route is cacheable (immutable id); never lists unapproved photos.
- Cart stores SKU + quantity only (never a price); one active cart per user (partial unique index); merge idempotent (max, not sum).
- Wishlist max 100 per user, enforced under the user-row lock; idempotent add.
- JS budget: nothing eager in header/layout/card/cart bundles beyond a few hundred bytes; en + hi; events for each action.

## Review focus

- Two parallel uploads at 7 photos must end at 8, not 9 (lock + test).
- Merge twice gives the same cart; merge with unknown or inactive SKU drops it and says so.
- Another user's cart/wishlist is never reachable (no ids in the URL).
- Photo removed or rejected stops being served.
- Storage keys missing (Q112): 503 `PHOTOS_UNAVAILABLE`, no rows.

## Tasks

- [x] 1. Shared: DTOs (`product-photos`, `cart-api`, `wishlist-api`), setting key, analytics events, error codes. Tests: schemas.
- [x] 2. DB: schema + migration + repos (test first: limit race, order, approval, cart merge, wishlist limit, role-leak).
- [x] 3. API: image processing variants (`processProductPhoto`), routes, tests via `app.request`.
- [x] 4. Web: `ProductPhoto`, card + product page, lazy wishlist heart, cart sync, account Wishlist, admin editor, state-audit rows.
- [x] 5. Docs, learnings, targeted checks, commits.
