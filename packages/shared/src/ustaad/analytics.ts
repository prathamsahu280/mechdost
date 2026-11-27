/**
 * Ustaad Network analytics (spec 23 § 16; spec 12; hard rules 9 and 16). Ids, codes and counts only: never text,
 * names, phones or locations. Merged into `ServerEventProps` and `CLIENT_EVENT_SCHEMAS` in `../analytics.ts`, so one
 * catalogue stays the source; this file exists so the network's events do not collide with other workstreams.
 * A member in restricted mode emits no events at all (SR-42; enforced in `recordUstaadEvent`).
 */
import { z } from 'zod';
import { USTAAD_SAVE_KINDS } from './saved';
import {
  type CORRECTION_APPLIED,
  type JOB_ROLES,
  type MEDIA_KINDS,
  type MEDIA_REJECT_REASONS,
  type MODERATION_ACTIONS,
  type POST_KINDS,
  type POST_TEMPLATES,
  type REPORT_CLOCKS,
  type REPORT_REASONS,
  type REPORT_TARGETS,
  type USTAAD_LEVELS,
  type USTAAD_TRACKS,
  type USTAAD_VERIFY_METHODS,
  type USTAAD_ACCESS_MODES,
  type MESSAGE_KINDS,
  type PROMOTION_HIDE_REASONS,
  COACHMARK_TARGETS,
  PROMOTION_SLOTS,
} from './codes';
import type { USTAAD_CONNECTION_STATUSES, USTAAD_THREAD_STATUSES } from '../state';

type Of<T extends readonly string[]> = T[number];

/** Server events (event store, forwarded to PostHog by the worker). */
export interface UstaadServerEventProps {
  ustaad_joined: { memberId: string; track: Of<typeof USTAAD_TRACKS>; via: 'ustaad' | 'partners_apply' };
  ustaad_left: { memberId: string };
  ustaad_verification_requested: { memberId: string; proofs: Of<typeof USTAAD_VERIFY_METHODS>[] };
  ustaad_verification_decided: {
    memberId: string;
    outcome: 'approved' | 'rejected' | 'revoked';
    reason: string | null;
  };
  ustaad_vouch_given: { voucherId: string; voucheeId: string };
  ustaad_attestation_decided: { memberId: string; outcome: 'confirmed' | 'declined' | 'expired' };
  ustaad_level_reached: { memberId: string; level: Of<typeof USTAAD_LEVELS> };
  ustaad_badge_earned: { memberId: string; badge: string };
  ustaad_post_created: {
    postId: string;
    kind: Of<typeof POST_KINDS>;
    template: Of<typeof POST_TEMPLATES> | null;
    mediaCount: number;
    tagCount: number;
    correction: Of<typeof CORRECTION_APPLIED>;
  };
  ustaad_story_created: { postId: string; kind: Of<typeof POST_KINDS> };
  /** D1: a reply on a post (voice, photo or text); `reply` = an answer to another comment. */
  ustaad_comment_posted: {
    commentId: string;
    postId: string;
    input: 'voice' | 'photo' | 'text';
    reply: boolean;
  };
  ustaad_question_asked: {
    questionCode: string;
    input: 'voice' | 'photo' | 'text';
    segment: string | null;
    work: string | null;
    correction: Of<typeof CORRECTION_APPLIED>;
  };
  ustaad_answer_posted: { answerId: string; input: 'voice' | 'photo' | 'text' };
  ustaad_answer_helpful: { answerId: string };
  ustaad_best_answer_chosen: { questionCode: string; answerId: string };
  ustaad_followed: { followerId: string; followeeId: string };
  ustaad_connected: { memberId: string; otherId: string };
  ustaad_mentorship_changed: { mentorshipId: string; to: string };
  ustaad_message_thread_started: { threadId: string };
  /** D2 graph and messages: ids and codes only (never text). */
  ustaad_unfollowed: { followerId: string; followeeId: string };
  ustaad_connection_changed: { connectionId: string; to: Of<typeof USTAAD_CONNECTION_STATUSES> };
  ustaad_member_blocked: { memberId: string; on: boolean };
  ustaad_member_muted: { memberId: string; on: boolean };
  ustaad_message_thread_changed: { threadId: string; to: Of<typeof USTAAD_THREAD_STATUSES> };
  ustaad_message_sent: { threadId: string; kind: Of<typeof MESSAGE_KINDS>; held: boolean };
  ustaad_dm_read_by_staff: { threadId: string; reason: string };
  /** D2 Discover and promotions (server side; the client events stay for the UI's own impressions). */
  ustaad_discover_served: { results: number; filters: number };
  ustaad_promo_served: { promo: string; slot: Of<typeof PROMOTION_SLOTS> };
  ustaad_promo_clicked: { promo: string; slot: Of<typeof PROMOTION_SLOTS> };
  ustaad_promo_hidden_by_member: { promo: string; reason: Of<typeof PROMOTION_HIDE_REASONS> };
  ustaad_job_posted: { jobCode: string; role: Of<typeof JOB_ROLES> };
  ustaad_job_applied: { jobCode: string; applicationId: string };
  ustaad_application_moved: { applicationId: string; to: string };
  /** SIM-P24: a member filed an appeal against a decision on them or their content (a support ticket). */
  ustaad_appeal_filed: { reportId: string };
  ustaad_report_created: {
    reportCode: string;
    reason: Of<typeof REPORT_REASONS>;
    target: Of<typeof REPORT_TARGETS>;
  };
  ustaad_moderation_action: {
    action: Of<typeof MODERATION_ACTIONS>;
    reason: string;
    clock: Of<typeof REPORT_CLOCKS> | null;
    onTime: boolean | null;
  };
  ustaad_media_rejected: {
    mediaId: string;
    kind: Of<typeof MEDIA_KINDS>;
    reason: Of<typeof MEDIA_REJECT_REASONS>;
  };
  ustaad_media_budget_full: { kind: Of<typeof MEDIA_KINDS> };
  ustaad_location_confirmed: {
    source: 'gps' | 'manual';
    accuracyBand: 'lt20' | '20to50' | '50to100' | 'gt100';
  };
  ustaad_zone_counts_built: { zones: number };
  ustaad_application_mapped: { outcome: 'invited' | 'joined' | 'closed' | 'skipped' };
  ustaad_takedown_executed: { clock: Of<typeof REPORT_CLOCKS>; seconds: number };
  ustaad_restricted_mode: { memberId: string; reason: 'minor_report' | 'review' | 'cleared' };
  /** Workstream B round 3: profile and choices saves (field counts, never values). */
  ustaad_profile_updated: { memberId: string; fields: number };
  ustaad_choices_saved: { memberId: string; fields: number };
  /** SR-2: perks and job posting paused after a credential change on a Pakka+ account. */
  ustaad_security_freeze: {
    memberId: string;
    reason: 'phone_changed' | 'email_changed' | 'password_changed';
  };
  /** Non-partner owner link issued by staff (SR-6). */
  ustaad_attest_link_issued: { attestationId: string };
  /** Nightly reconcile found counters that drifted from their source rows. */
  ustaad_counter_drift: { members: number };
  admin_ustaad_settings_saved: { keys: string[] };
  admin_ustaad_invariant_refused: { key: string };
  /** Admin → Ustaad tables (task G1): which table, what was done; never the text. */
  admin_ustaad_table_saved: {
    table:
      | 'levels'
      | 'badges'
      | 'tags'
      | 'words'
      | 'reasons'
      | 'reach_cities'
      | 'promotions'
      | 'tutorial_cards'
      | 'coachmarks'
      | 'reserved_names';
    action: 'create' | 'update' | 'merge' | 'move';
  };
  /** The staff preview switch (founder 2026-11-26). */
  admin_ustaad_access_changed: { from: Of<typeof USTAAD_ACCESS_MODES>; to: Of<typeof USTAAD_ACCESS_MODES> };
}

/** Runtime list of the server event names (tests check the catalogue covers spec 23 § 16). */
export const USTAAD_SERVER_EVENTS = [
  'ustaad_joined',
  'ustaad_left',
  'ustaad_verification_requested',
  'ustaad_verification_decided',
  'ustaad_vouch_given',
  'ustaad_attestation_decided',
  'ustaad_level_reached',
  'ustaad_badge_earned',
  'ustaad_post_created',
  'ustaad_story_created',
  'ustaad_comment_posted',
  'ustaad_question_asked',
  'ustaad_answer_posted',
  'ustaad_answer_helpful',
  'ustaad_best_answer_chosen',
  'ustaad_followed',
  'ustaad_connected',
  'ustaad_mentorship_changed',
  'ustaad_message_thread_started',
  'ustaad_unfollowed',
  'ustaad_connection_changed',
  'ustaad_member_blocked',
  'ustaad_member_muted',
  'ustaad_message_thread_changed',
  'ustaad_message_sent',
  'ustaad_dm_read_by_staff',
  'ustaad_discover_served',
  'ustaad_promo_served',
  'ustaad_promo_clicked',
  'ustaad_promo_hidden_by_member',
  'ustaad_job_posted',
  'ustaad_job_applied',
  'ustaad_application_moved',
  'ustaad_appeal_filed',
  'ustaad_report_created',
  'ustaad_moderation_action',
  'ustaad_media_rejected',
  'ustaad_media_budget_full',
  'ustaad_location_confirmed',
  'ustaad_zone_counts_built',
  'ustaad_application_mapped',
  'ustaad_takedown_executed',
  'ustaad_restricted_mode',
  'ustaad_profile_updated',
  'ustaad_choices_saved',
  'ustaad_security_freeze',
  'ustaad_attest_link_issued',
  'ustaad_counter_drift',
  'admin_ustaad_settings_saved',
  'admin_ustaad_invariant_refused',
  'admin_ustaad_table_saved',
  'admin_ustaad_access_changed',
] as const satisfies readonly (keyof UstaadServerEventProps)[];

const count = z.number().int().min(0).max(100_000);
const code = z.string().regex(/^[a-z0-9_]{1,40}$/);

/** Client events (browser, consent-gated like every client event). */
export const USTAAD_CLIENT_EVENT_SCHEMAS = {
  ustaad_feed_viewed: z.object({ tab: z.enum(['for_you', 'following']) }).strict(),
  ustaad_post_liked: z.object({ via: z.enum(['button', 'double_tap']) }).strict(),
  ustaad_post_saved: z.object({}).strict(),
  /** U2 (UI upgrade 2026-11-27): "Kaam ki baat / Useful" reaction, before/after toggle, composer tiles. */
  ustaad_post_useful: z.object({}).strict(),
  ustaad_before_after_toggled: z.object({ to: z.enum(['before', 'after']) }).strict(),
  ustaad_composer_more_opened: z.object({}).strict(),
  ustaad_camera_opened: z.object({ source: z.enum(['camera', 'gallery']) }).strict(),
  /** The shared Save control (2026-11-28): any kind saved or unsaved; ids never leave the browser. */
  ustaad_item_save_toggled: z.object({ kind: z.enum(USTAAD_SAVE_KINDS), saved: z.boolean() }).strict(),
  ustaad_post_shared: z.object({ channel: z.enum(['whatsapp', 'copy_link', 'member']) }).strict(),
  ustaad_story_viewed: z.object({}).strict(),
  ustaad_video_played: z.object({ secondsBand: z.enum(['lt15', '15to60', '60to180', 'gt180']) }).strict(),
  ustaad_voice_played: z.object({}).strict(),
  /** Voice-note player (founder 2026-11-28): how the listener moved and to which whole second; never ids or text. */
  ustaad_voice_seeked: z
    .object({ via: z.enum(['tap', 'drag', 'key', 'skip']), seconds: z.number().int().min(0).max(3600) })
    .strict(),
  ustaad_voice_speed_changed: z.object({ rate: z.enum(['1', '1.5', '2']) }).strict(),
  /** The author sent a voice note or video with a typed summary and/or captions (founder 2026-11-27 night). */
  ustaad_media_text_added: z
    .object({ kind: z.enum(['audio', 'video']), summary: z.boolean(), captions: z.boolean() })
    .strict(),
  ustaad_discover_searched: z.object({ results: count }).strict(),
  ustaad_tag_opened: z.object({}).strict(),
  ustaad_promo_impression: z.object({ promo: z.uuid(), slot: z.enum(PROMOTION_SLOTS) }).strict(),
  ustaad_promo_click: z.object({ promo: z.uuid() }).strict(),
  ustaad_promo_hidden: z.object({ reason: code }).strict(),
  ustaad_correction_shown: z
    .object({
      engine: z.enum(['llm_anthropic', 'llm_gemini', 'wordlist']),
      mode: z.enum(['suggest', 'auto']),
      changes: count,
    })
    .strict(),
  ustaad_correction_choice: z.object({ choice: z.enum(['use', 'keep', 'edit']) }).strict(),
  ustaad_data_saver: z.object({ on: z.boolean() }).strict(),
  /** SIM-P18: the employer opened the applicants list of their job (how many were shown on the first page). */
  ustaad_job_applicants_viewed: z.object({ count }).strict(),
  ustaad_learn_completed: z.object({ resource: z.uuid() }).strict(),
  ustaad_join_step: z
    .object({ step: z.number().int().min(1).max(5), via: z.enum(['ustaad', 'partners_apply']) })
    .strict(),
  tutorial_started: z.object({}).strict(),
  tutorial_step: z.object({ card: z.number().int().min(1).max(12), narrationPlayed: z.boolean() }).strict(),
  tutorial_completed: z.object({}).strict(),
  tutorial_skipped: z.object({ atCard: z.number().int().min(1).max(12) }).strict(),
  ustaad_coachmark_seen: z.object({ target: z.enum(COACHMARK_TARGETS) }).strict(),
  ustaad_coachmark_dismissed: z.object({ target: z.enum(COACHMARK_TARGETS) }).strict(),
  ustaad_help_replayed: z.object({}).strict(),
  /** The garage owner's page (SR-6): opened, location asked, answer sent (the decision itself is a server event). */
  ustaad_attest_opened: z.object({ valid: z.boolean() }).strict(),
  ustaad_attest_location: z.object({ outcome: z.enum(['found', 'denied', 'unavailable']) }).strict(),
  ustaad_attest_sent: z.object({ decision: z.enum(['confirmed', 'declined']), ok: z.boolean() }).strict(),
  /** Admin → Ustaad (G1): a settings save or a list change; area = `settings` or the list's id; never values. */
  admin_ustaad_change: z
    .object({
      area: z.enum([
        'settings',
        'levels',
        'badges',
        'tags',
        'reasons',
        'cities',
        'promotions',
        'cards',
        'coachmarks',
        'words_protected',
        'words_correction',
        'words_banned',
        'words_pii_pattern',
        'words_link_domain',
        'words_scam_phrase',
        'preview_testers',
      ]),
      action: z.enum(['save', 'create', 'update', 'merge', 'move', 'remove']),
      fields: count,
    })
    .strict(),
  /** Admin → Ustaad community console (G2): a section opened (codes only, never ids, names or text). */
  admin_ustaad_console_viewed: z
    .object({
      section: z.enum([
        'queue',
        'holds',
        'appeals',
        'verify',
        'members',
        'legal',
        'names',
        'audit',
        'settings',
      ]),
    })
    .strict(),
  /** Admin → Ustaad community console (G2): a staff action and whether the API took it. */
  admin_ustaad_console_action: z
    .object({
      action: z.enum([
        'keep',
        'remove',
        'warn',
        'restrict',
        'ban',
        'ban_confirm',
        'appeal_link',
        'appeal_decide',
        'media_view',
        'thread_read',
        'verify_approve',
        'verify_reject',
        'owner_link',
        'sanction',
        'unban',
        'unban_confirm',
        'takedown',
        'name_add',
        'name_toggle',
      ]),
      outcome: z.enum(['ok', 'refused']),
    })
    .strict(),
  /** Shell navigation (A): which bottom tab was opened. */
  ustaad_tab_opened: z
    .object({ tab: z.enum(['home', 'ask', 'create', 'jobs', 'me', 'discover', 'learn']) })
    .strict(),
  /** UI upgrade U1 (design § 3.0, § 3.1, § 3.3): MechDost mark in the network header (back to the store). */
  ustaad_shell_home_logo: z.object({}).strict(),
  /** "See new posts" pill shown (once per check that found posts) and tapped. */
  ustaad_feed_new_pill_shown: z.object({}).strict(),
  ustaad_feed_new_pill_tapped: z.object({}).strict(),
  /** Home "More" sheet opened (the shortcuts beyond the first four). */
  ustaad_home_more_opened: z.object({}).strict(),
  /** A card in "Waiting for your answer" opened; position is 0-based. */
  ustaad_home_question_tapped: z.object({ position: z.number().int().min(0).max(50) }).strict(),
  /** Story viewer paused (button, or press and hold). */
  ustaad_story_paused: z.object({}).strict(),
  /** U4 (UI upgrade § 3.8): the level sheet opened from a level tag; `own` = my own tag. */
  ustaad_level_sheet_opened: z
    .object({
      level: z.enum(['apprentice', 'ustaad_pending', 'naya', 'pakka', 'bada', 'master']),
      own: z.boolean(),
    })
    .strict(),
  /** U4: my card sent from Me (WhatsApp teaser link). */
  ustaad_card_shared: z.object({ channel: z.enum(['whatsapp']) }).strict(),
  /** U4 (founder Q-UI-2): the weekly "you helped N mechanics" note was shown; a band, never names. */
  ustaad_helped_note_seen: z.object({ band: z.enum(['1', '2-5', '6+']) }).strict(),
  /** U4 (founder Q-UI-1): Learn and Discover reached from the Me shortcuts. */
  ustaad_me_shortcut: z.object({ to: z.enum(['learn', 'discover']) }).strict(),
  /** U4 (§ 3.5): "Continue" on a half-watched video. */
  ustaad_learn_continue_tapped: z.object({}).strict(),
  /** U4 (§ 3.6): the one-line scam warning on Jobs expanded. */
  ustaad_job_scam_line_opened: z.object({}).strict(),
} as const;
