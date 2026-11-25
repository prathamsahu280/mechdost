# Ustaad Network: design (2026-11-26)

Spec: `docs/specs/23-ustaad-network.md` · Plan: `docs/superpowers/plans/2026-11-26-ustaad-network.md` · Decisions:
2026-11-26 "Ustaad Network".

## Intent

A mechanics-only professional network inside MechDost for Chhattisgarh: "हुनर दिखाओ। पहचान बनाओ।". Juniors (Chhotu)
ask and learn; experts (Ustaad: Naya → Pakka → Bada → Master) answer, show their work and earn Izzat. It must feel like
something an Indian mechanic already uses: WhatsApp-style voice notes and chats, YouTube-style videos, big tiles,
plain words, low data. MechDost gains a daily reason for mechanics to open the app, a verified mechanic graph and
structured repair data (problem × vehicle × fix × part) that feeds the parts business.

## Goals

- Everything at once (founder ruling): join (which replaces "Apply as a mechanic"), ID card, verification, levels,
  Izzat, badges, voice/photo/text Q&A, a feed with every media kind incl. stories and 180 s video, likes, replies,
  saves, shares, hashtags, follow, connect, messages, mentorship, Discover, garage pin, zone counts, jobs, learning, a
  first-time tutorial, smart correction, moderation and a full admin.
- Safe by construction: the 46 security requirements of the design review, the legal duties (IT Rules clocks,
  POCSO, DPDP consents per purpose, CERT-In) and the project hard rules (integrity, RBAC, Hindi, events, admin control).
- Free or near-free infrastructure at launch (R2 free tier, small LLM with a word-list fallback, no transcoding).

## Non-goals (decide later or ruled out)

Udhaar/credit, job card and GST invoice for mechanics, trade prices, certificate upload (PENDING #25–#28); speech to
text and voice search (ruled out); server video transcoding, server auto-blur, PDF sanitiser and antivirus, CSAM hash
matching (next step, needs access); outside advertisers; paid mentorship; customer-facing profiles; mobile app.

## Approaches considered

1. **One spine: the product study's blend "C spine + A loop"** (ID card + voice Q&A first, feed later). Rejected by the
   founder ("build everything at once"); its ideas survive as the card, the mic hero and the Q&A loop.
2. **Feed-first (Instagram-like)** with Q&A as a post type. Rejected: questions get buried, and the founder's rejected
   UI rounds warn against a copied look. Kept as one tab of Home, with Q&A its own surface.
3. **Chosen: a tabbed mechanic app inside MechDost** (Home · Discover · Create · Learn · Me), Q&A and jobs reached from
   Home shortcuts, every module on shared foundations (membership, media pipeline, events, settings, moderation), so
   the build can run in parallel workstreams without one blocking the others.

Technical choices: a new `ustaad_media` table (the existing `media_objects` is locked to WebP ≤ 8 MB); direct uploads
with presigned PUT into a quarantine bucket, verified by size, magic bytes and container duration, images re-encoded
with the existing `sharp` pipeline; SigV4 presigning in-house (no AWS SDK); LLM calls with plain `fetch` (no SDK);
zones from a pure-TypeScript hex grid instead of H3 (no new dependency or extension); counters as separate rows
updated only when the source row was inserted; feed ranking into a 10-minute Redis snapshot with a position cursor.

## Rulings that shape the design

Founder (2026-11-26): everything at once; Chhotu/Ustaad names and the demo level rules with followers; **no age
check**; Izzat (not spendable) + Coins only; owner + vouch with staff final approval; open to all; area + circle by
default, exact pin opt-in; 180 s video; visible like and follower counts; mechanics only; Chhattisgarh; a
community_manager role; MechDost promotions only, labelled Sponsored; smart correction suggest/auto/off; Hindi +
English UI, voice in any language; every threshold admin-configurable; "Apply as a mechanic" becomes the join; a
first-time tutorial.

Coordinator (2026-11-26): audio-only voice notes, no speech-to-text; LLM smart correction behind an adapter with a
word-list fallback; Cloudflare R2 behind a MediaHost adapter with Supabase as the fallback; security-review
resolutions: staff final approval locked on, **qualified followers** only for levels, server-side distance bands with
stable noise and pin-change limits, request-only messages for everyone with a hidden phone, the Sponsored label
locked, WhatsApp shares as teasers, quarantine bucket and 150 MB cap, PDFs as downloads from a separate host,
SSRF-safe link previews, ≤ 10-minute signed URLs, a city-scoped 2FA community manager without PII or exports,
restricted mode on a minor report, admin invariants, video above 180 s only by a super admin with a reason.

## Where research was overruled, and the compensating control

| Research said                            | Ruling                  | Control in the design                                                              |
| ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------- |
| 18+ gate with date of birth              | No age check            | Minor report → restricted mode; no-minors job attestation; pre-moderation; counsel |
| Rename "Chhotu" to "Shagird"             | Keep Chhotu             | Neutral code `apprentice`, label editable without a migration                      |
| Followers never count for levels         | Followers count         | Only qualified followers; ring detection; staff approval for Bada and Master       |
| Hide like and follower counts            | Visible                 | Discover ranks by helpful/best answers, not followers                              |
| No stories, 45 s video at MVP            | Stories and 180 s video | Data saver, no autoplay, quotas, R2 budget, story purge, admin caps                |
| Speech-to-text for search and moderation | No speech-to-text       | Typed captions and tags for search; reports and pre-moderation for voice           |

## What's left

- User inputs: R2 account and keys (Q-U1), LLM provider and key (Q-U3), Grievance Officer (Q-U4), message default
  (Q-U5), image-safety classifier and hash-list access (Q-U6), counsel items (Q-UC1–7).
- Next technical steps after launch: sandboxed ffmpeg transcoding, server blur/OCR, PDF sanitiser and antivirus, Web
  Risk checks, CSAM hash matching.
- Field check in Raipur before launch: copy in Hindi with real mechanics, data use on a 2 GB phone, moderation load.
