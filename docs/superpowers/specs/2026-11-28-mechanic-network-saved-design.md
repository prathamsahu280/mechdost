# Mechanic Network — Saved, upgraded (design, 2026-11-28)

Founder, 2026-11-28: "we can add saving a post or smth that the user might wanna use later" and "check the common
platforms that the mechanics use like whatsapp and instagram and facebook (maybe)". Extends spec 23 § 5 (Saved).

## Founder summary (read this first)

- Mechanics already "save" things in WhatsApp (starred messages, the "Message yourself" chat), Instagram (Saved with
  named collections) and Facebook (Saved items with collections). We copy the habits they know: **one tap to save, a
  named folder if you want, and one place to find it again**.
- **Built tonight (no new decision needed):** save questions, answers, jobs and Learn lessons as well as posts; your
  own named collections ("Wiring", "Part prices", "Tips" suggested); a Saved list with kind and collection filters,
  word search and counts; one shared Save button that says "Saved / सेव किया" in words.
- **Needs your OK (not built):** (1) "Send to my WhatsApp" for questions, jobs and lessons (today only posts have a
  safe public teaser link); (2) the collection limit (20) and the suggested names as admin settings; (3) saving voice
  notes / videos to the phone for offline use.

## What we found (research, 2026-11-28, ~20 minutes)

| Platform  | How people keep things                                                                                                                                                                | How they find it again                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| WhatsApp  | **Starred messages** (long-press → star; private; survive "clear chat except starred") and the **Message yourself** chat used as a notes/files folder (rolled out Nov 2022).          | Settings → Starred messages (all chats) or per chat; scrolling the self-chat. |
| Instagram | **Saved** bookmark; long-press → **named private collections**; a post can sit in several collections; tap a ticked collection to take it out (2017 onwards).                         | Profile → Saved → collection.                                                 |
| Facebook  | **Save** (since 2014) into **collections** (suggested or own, "Only me" by default, optional contributors); Marketplace has its own saved items.                                      | Menu → Saved → collection; options → Unsave.                                  |
| YouTube   | Watch later, playlists, downloads (from general knowledge, not re-checked tonight).                                                                                                   | Library.                                                                      |
| Learning  | Hindi upskilling apps for mechanics exist (MechanikTV, ~50,000 mechanics; error codes, BS6 courses); NIMI/Bharat Skills videos on reading wiring diagrams for engine-no-start faults. | In-app.                                                                       |

Sources: [TechCrunch — Message yourself](https://techcrunch.com/2022/11/28/whatsapp-rolls-out-a-feature-that-makes-it-easier-to-message-yourself/),
[Digit — starred messages](https://www.digit.in/how-to/apps/starred-messages-on-whatsapp-learn-how-to-bookmark-important-messages-find-them-later.html),
[Instagram — organise saved posts](https://about.instagram.com/blog/announcements/introducing-new-ways-to-organize-your-saved-posts),
[TechCrunch — Instagram private collections](https://techcrunch.com/2017/04/17/instagram-now-lets-you-organize-bookmarks-into-private-collections/),
[Meta — Introducing Save on Facebook](https://about.fb.com/news/2014/07/introducing-save-on-facebook/),
[Social Media Examiner — Facebook collections](https://www.socialmediaexaminer.com/how-to-use-facebook-collections-to-manage-curated-content/),
[EVO India — MechanikTV](https://www.evoindia.com/article/mechaniktv-an-android-app-to-upskill-indias-mechanics),
[Bharat Skills — Mechanic Diesel videos](https://www.bharatskills.gov.in/content/nimi-videos/mechanic-diesel).

**Inference (not measured):** no study tonight showed exactly what Indian mechanics save. From the network's own
content and the platforms above we expect: fault videos and voice notes, wiring diagrams (photos/screenshots), part
numbers and prices, tool tips, parts-seller contacts and job posts; and they look things up by vehicle/brand and by
a few self-named folders rather than by tags. Worth checking in the next founder call with 3–5 mechanics.

## What we take

1. **One tap, private.** Save is private (like a star); counts are shown only to the author (unchanged).
2. **Named collections like Instagram/Facebook**, optional: saving never forces a folder; "All saved" is the
   default; an item can be in several collections; ticking again takes it out. Suggested names: Wiring, Part
   prices, Tips (en + hi).
3. **Save everything useful**, not only posts: questions, answers (the most "use later" item: a fix that worked),
   jobs and Learn lessons.
4. **Find it again:** kind filter (Posts / Questions / Answers / Jobs / Lessons), collection filter, word search over
   the saved text, counts.
5. **WhatsApp as the exit:** "Send to my WhatsApp" re-uses the post teaser link (no post text, no phone numbers).

## What we do not take

- Shared/collaborative collections (Facebook contributors) — privacy risk on a mechanics network; not now.
- Public collections or "most saved" lists of other people's saves.
- Downloads of other members' media to the phone (rights + data use); revisit with the founder (item 3 above).

## Status update (2026-11-28, batch N)

The "saved by me" flags on question, answer, job and lesson views are built (spec 23 § 21i-L): the Save control starts
in the right state. Still open: "Send to my WhatsApp" for non-post kinds, admin settings for the collection limit and
suggested names, an e2e of the page and sheet.

## Build (2026-11-28, branch `worktree-agent-a754e32db80755c6d`)

- **DB** `0190_ustaad_saved_collections`: `ustaad_saved_items` (member, kind ∈ question/answer/job/lesson, target id;
  PK member+kind+target; index member+created_at), `ustaad_save_collections` (id, member, name 1–40, unique
  `lower(name)` per member, version + updated_at triggers), `ustaad_save_collection_items` (collection, member, kind ∈
  all five, target; PK collection+kind+target; index member+kind+target). RLS on, `REVOKE` from anon/authenticated.
  Posts keep `ustaad_saves` (counters/ranking unchanged). Targets are polymorphic (no FK): every read joins the live
  row and drops what the member may no longer see (status, city/reach, blocks either way).
- **Repo** `packages/db/src/repo/ustaad/saved.ts`: save/unsave any kind (visibility by the kind's own rule, 404
  otherwise; event only when a row was inserted/deleted; lesson events on the member entity with `lesson_id` in
  props), list (UNION over the five kinds, keyset on save time, kind/collection/word filters, collections per item),
  summary (counts + collections), collections create (advisory lock per member, max 20, case-insensitive unique →
  409), rename (compare-and-set on version → 409), delete (saves stay), add/remove item (must be my save; foreign
  collection → 404). Unsave removes the item from my collections in the same transaction.
- **API** `apps/api/src/routes/ustaad/saved.ts`: `GET /ustaad/saves`, `GET /ustaad/saves/summary`,
  `PUT|DELETE /ustaad/saves/{kind}/{id}`, `POST /ustaad/save-collections`, `PATCH|DELETE /ustaad/save-collections/{id}`,
  `PUT|DELETE /ustaad/save-collections/{id}/items/{kind}/{itemId}`. Members only; rate limits: reads
  `memberReads`, toggles new `saves` (200/day), collection writes `membershipWrites`.
- **Web** `components/ustaad/saved/save-control.tsx` (`SaveControl`): aria-pressed + the word, optimistic with
  rollback (`lib/ustaad/save-toggle.ts`), words in `ustaad.saveControl.*` (en + hi), event
  `ustaad_item_save_toggled {kind, saved}`. The lead wires it into the restyled cards (U2/U4) at merge.
- **Not built tonight:** the Saved page tabs/search UI and the collections sheet (API ready), the Me entry line,
  "Send to my WhatsApp".
