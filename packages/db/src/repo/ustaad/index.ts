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
export * from './onboarding';
export * from './application-links';
export * from './card';
// G1 (Admin → Ustaad settings and tables).
export * from './admin';
export * from './qa';
export * from './learn';
// D: export * from './posts'; export * from './feed'; export * from './graph'; export * from './threads'; …
export * from './location';
export * from './zones';
export * from './jobs';
// F: export * from './reports'; …
