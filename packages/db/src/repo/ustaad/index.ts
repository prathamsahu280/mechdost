/**
 * Ustaad Network repositories (spec 23). One file per area; each workstream adds its own files and one export line
 * here (A owns the order; B identity, C qa/learn, D feed/graph/threads/discover/promotions, E location/zones/jobs,
 * F reports/moderation). Names carry the `ustaad` prefix so they never collide with the marketplace repositories.
 */
export * from './events';
export * from './settings';
export * from './members';
export * from './profile';
export * from './media';
export * from './names';
export * from './izzat';
export * from './levels';
export * from './moderation';
export * from './notify';
export * from './verification';
export * from './attest';
export * from './maintenance';
export * from './onboarding';
export * from './application-links';
export * from './card';
// G1 (Admin → Ustaad settings and tables).
export * from './admin';
export * from './qa';
export * from './learn';
// D part 1 (feed): posts, stories, comments, reactions, tags, previews, feed.
export * from './posts';
export * from './stories';
export * from './comments';
export * from './reactions';
// Saved beyond posts + collections (2026-11-28).
export * from './saved';
export * from './tags';
export * from './previews';
export * from './feed';
export { visibleUstaadPost } from './feed-common';
// D2: graph, messages, Discover, promotions (serve side).
export * from './graph-common';
export * from './follows';
export * from './connections';
export * from './blocks';
export * from './messages';
export * from './discover';
export * from './promotions';
// D web: another member's profile and posts.
export * from './profile-view';
export * from './location';
export * from './zones';
export * from './jobs';
export * from './standing';
// F2: reports, moderation (above), strikes, the removed-content archive.
export * from './reports';
export * from './strikes';
export * from './removed-archive';
// G2: the community manager console (media view, members for staff, legal list, own audit trail) and the
// publish side effects a keep runs.
export * from './console';
export * from './publish';
// Preview testers (founder 2026-11-27): named non-staff accounts let in during staff_preview.
export * from './testers';
