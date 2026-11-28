/**
 * Ustaad Network codes (docs/specs/23-ustaad-network.md). One source for the database CHECKs, the DTOs, the API and the
 * web: every reason, kind and status is a code (hard rule 16), labels live in the `ustaad` locale namespace.
 */
import { VEHICLE_SEGMENTS } from '../vehicle-segments';

/** Permissions added by the network (spec 23 § 3). Added to `PERMISSIONS` in `rbac.ts`. */
export const USTAAD_PERMISSIONS = [
  'ustaad:use',
  'ustaad:answer',
  'ustaad:vouch',
  'ustaad:jobs_post',
  'ustaad:read',
  'ustaad:moderate',
  'ustaad:verify',
  'ustaad:location_exact',
  'ustaad:promotions',
  'ustaad:settings',
  'ustaad:takedown',
] as const;
export type UstaadPermission = (typeof USTAAD_PERMISSIONS)[number];

/** Who reaches `/ustaad` (founder 2026-11-26: a staff preview before the launch). Setting `ustaad.access`. */
export const USTAAD_ACCESS_MODES = ['off', 'staff_preview', 'open'] as const;
export type UstaadAccessMode = (typeof USTAAD_ACCESS_MODES)[number];

/**
 * Preview testers (founder 2026-11-27): why a named non-staff account may enter during `staff_preview`, and why it was
 * taken off the list. Codes, not free text (hard rule 16); an optional note rides along.
 */
export const USTAAD_TESTER_ADD_REASONS = ['qa_run', 'beta_mechanic', 'founder_request', 'other'] as const;
export const USTAAD_TESTER_REMOVE_REASONS = [
  'run_finished',
  'no_longer_needed',
  'added_by_mistake',
  'other',
] as const;
/** Most accounts the list may hold at once (a preview, not a launch). */
export const USTAAD_TESTERS_MAX = 50;

/** Track codes are neutral so the labels ("Chhotu", "Ustaad") can be renamed without a migration. */
export const USTAAD_TRACKS = ['apprentice', 'ustaad'] as const;
export type UstaadTrack = (typeof USTAAD_TRACKS)[number];

/** The ladder in order (spec 23 § 9.2). `ustaad_pending` = "Ustaad · to verify". */
export const USTAAD_LEVELS = ['apprentice', 'ustaad_pending', 'naya', 'pakka', 'bada', 'master'] as const;
export type UstaadLevel = (typeof USTAAD_LEVELS)[number];

export const USTAAD_MEMBER_STATUSES = ['active', 'restricted', 'banned', 'left'] as const;
export type UstaadMemberStatus = (typeof USTAAD_MEMBER_STATUSES)[number];

export const USTAAD_VERIFICATION_STATES = [
  'unverified',
  'pending_verification',
  'verified',
  'revoked',
] as const;
export type UstaadVerificationState = (typeof USTAAD_VERIFICATION_STATES)[number];

export const USTAAD_RESTRICTED_MODES = ['none', 'minor_report', 'review'] as const;
export const USTAAD_WORK_PLACES = ['shop', 'home_roadside'] as const;
export const USTAAD_DM_MODES = ['everyone', 'request', 'nobody'] as const;
export const USTAAD_CORRECTION_MODES = ['suggest', 'auto', 'off'] as const;
export type UstaadCorrectionMode = (typeof USTAAD_CORRECTION_MODES)[number];
export const USTAAD_LANGS = ['hi', 'en'] as const;

/** Vehicle specialities reuse `VEHICLE_SEGMENTS` where they match, plus `ev` (spec 23 § 6.1). */
export const USTAAD_SEGMENT_CODES = [
  ...VEHICLE_SEGMENTS.filter(
    (s): s is Exclude<(typeof VEHICLE_SEGMENTS)[number], 'construction_otr' | 'not_vehicle'> =>
      s !== 'construction_otr' && s !== 'not_vehicle',
  ),
  'ev',
] as const;
export type UstaadSegmentCode = (typeof USTAAD_SEGMENT_CODES)[number];

export const USTAAD_WORK_CODES = [
  'engine',
  'electrical',
  'ac',
  'diagnostics',
  'tyres',
  'battery',
  'denting_painting',
  'suspension_brakes',
] as const;
export type UstaadWorkCode = (typeof USTAAD_WORK_CODES)[number];
export const USTAAD_SPECIALITY_CODES = [...USTAAD_SEGMENT_CODES, ...USTAAD_WORK_CODES] as const;
export type UstaadSpecialityCode = (typeof USTAAD_SPECIALITY_CODES)[number];
export const USTAAD_SPECIALITY_STEPS = ['shuru', 'pakka', 'mahir'] as const;

/** Proofs chosen at join or from Me (certificate is "Coming soon", PENDING #28). */
export const USTAAD_VERIFY_METHODS = ['owner', 'vouch', 'certificate'] as const;
export const USTAAD_VERIFY_REJECT_REASONS = [
  'owner_unreachable',
  'proofs_mismatch',
  'duplicate_account',
  'other',
] as const;
export const USTAAD_VOUCH_RELATIONS = ['worked_together', 'trained_by', 'known_work'] as const;

export const USTAAD_IZZAT_REASONS = [
  'answer_posted',
  'best_answer',
  'helpful_received',
  'follower_gained',
  'video_completed',
  'strike',
  'reversal',
  'correction',
] as const;
export type UstaadIzzatReason = (typeof USTAAD_IZZAT_REASONS)[number];

export const USTAAD_BADGE_KINDS = ['speciality', 'fun', 'level'] as const;
export const USTAAD_BADGE_RULE_KINDS = [
  'best_answers_with_tag',
  'helpful_answers_in_segment',
  'apprentice_answers_in_week',
  'first_post',
  'first_question',
  'first_answer',
  'founding',
] as const;

export const USTAAD_EVENT_ENTITIES = [
  'member',
  'verification',
  'attestation',
  'vouch',
  'post',
  'question',
  'answer',
  'comment',
  'report',
  'job',
  'application',
  'mentorship',
  'connection',
  'message_thread',
  'media',
  'location',
] as const;

export const POST_KINDS = [
  'voice',
  'photo',
  'video',
  'text',
  'document',
  'poll',
  'link',
  'mixed',
  'story',
] as const;
export type UstaadPostKind = (typeof POST_KINDS)[number];
export const POST_TEMPLATES = ['fix_log', 'tip', 'before_after'] as const;
export const CONTENT_TYPES = ['ugc', 'mechdost_authored', 'sponsored'] as const;
export const CORRECTION_APPLIED = ['none', 'suggested_used', 'auto'] as const;
export const SAFETY_TAGS = ['brake', 'steering', 'fuel', 'airbag', 'ev_hv'] as const;
export const QUESTION_REACH = ['city', 'state'] as const;
export const TAG_GROUPS = ['vehicle_model', 'repair', 'part', 'tool'] as const;
export const TAG_SUGGESTION_STATES = ['open', 'accepted', 'rejected', 'merged'] as const;
export const MESSAGE_KINDS = ['text', 'voice', 'photo', 'post_share'] as const;
export const PROMOTION_SLOTS = ['feed', 'stories', 'search', 'jobs', 'learn', 'answer_parts'] as const;
export const PROMOTION_TARGETS = ['product', 'category', 'coupon', 'learning', 'url_internal'] as const;
export const PROMOTION_STATES = ['draft', 'scheduled', 'live', 'ended'] as const;
/** Slots served to members (D2): `answer_parts` is never served (no promotions on ask/answer screens, spec 23 § 9.5). */
export const PROMOTION_SERVED_SLOTS = ['feed', 'stories', 'search', 'jobs', 'learn'] as const;
/** Why a member hid a promotion (`POST /ustaad/promotions/{id}/hide`). */
export const PROMOTION_HIDE_REASONS = ['not_relevant', 'seen_too_often', 'misleading', 'other'] as const;
/** Why a message was held for staff (D2): the screening hook said hold, or a scam signal (fee, UPI, pay app). */
export const MESSAGE_HOLD_REASONS = ['screened', 'scam_phrase'] as const;
/** Per-member daily counters with an admin cap (D2): promotions served, Discover profiles served (SR-37). */
export const USTAAD_DAILY_COUNTER_KINDS = [
  'promo_served',
  'profiles_served',
  'follows',
  'new_threads',
  'connect_requests',
] as const;
/** Why a mentorship ended when a block forced it (spec 23 § 7.9). */
export const MENTORSHIP_END_REASONS = ['blocked', 'left', 'ended_by_member'] as const;
export const LEARNING_KINDS = ['hosted_video', 'external_link'] as const;
export const LEARNING_LABELS = ['none', 'mechdost_training'] as const;

export const MEDIA_KINDS = ['image', 'video', 'audio', 'document'] as const;
export type UstaadMediaKind = (typeof MEDIA_KINDS)[number];
export const MEDIA_HOSTS = ['r2', 'supabase'] as const;
export type UstaadMediaHostId = (typeof MEDIA_HOSTS)[number];
export const MEDIA_BUCKETS = ['quarantine', 'media', 'docs', 'evidence'] as const;
export type UstaadMediaBucket = (typeof MEDIA_BUCKETS)[number];
/** Object key prefix per bucket (`{prefix}/{memberId}/{uuid}.{ext}`). */
export const MEDIA_BUCKET_PREFIX = { quarantine: 'q', media: 'm', docs: 'd', evidence: 'e' } as const;
export const MEDIA_VARIANTS = ['img_1080', 'img_480', 'thumb', 'poster'] as const;
export type UstaadMediaVariant = (typeof MEDIA_VARIANTS)[number];
/** Allowed MIME types per kind (spec 23 § 6.4; SVG, HTML, archives and executables never, SR-17). */
export const MEDIA_MIMES = {
  image: ['image/webp', 'image/jpeg'],
  video: ['video/mp4', 'video/webm'],
  audio: ['audio/ogg', 'audio/webm', 'audio/mp4'],
  document: ['application/pdf'],
} as const satisfies Record<UstaadMediaKind, readonly string[]>;
/** Absolute byte ceilings per kind (the settings may only lower them). Video 150 MB is a locked ceiling (SR-15). */
export const MEDIA_HARD_CAP_BYTES = {
  image: 3 * 1024 * 1024,
  video: 150 * 1024 * 1024,
  audio: 10 * 1024 * 1024,
  document: 5 * 1024 * 1024,
} as const satisfies Record<UstaadMediaKind, number>;
export const MEDIA_REJECT_REASONS = [
  'size_mismatch',
  'type_mismatch',
  'magic_mismatch',
  'too_long',
  'too_large',
  'location_atom',
  'external_reference',
  'decompression_bomb',
  'expired_upload',
  'unreadable',
  'hash_mismatch',
  // F2 (SR-18): a CSAM hash match; the file is sealed in the evidence vault, never shown, never purged by normal jobs.
  'safety_block',
] as const;
/** Single PUT up to this size; above it resumable 8 MB parts (spec 23 § 10). */
export const MEDIA_SINGLE_PUT_MAX = 16 * 1024 * 1024;
export const MEDIA_PART_BYTES = 8 * 1024 * 1024;

export const REPORT_TARGETS = [
  'post',
  'story',
  'comment',
  'question',
  'answer',
  'member',
  'job',
  'message',
] as const;
/** `auto_safety` (F2): the image-safety classifier or a CSAM hash match opened the report (SR-18, POCSO task). */
export const REPORT_SOURCES = [
  'member',
  'auto_word',
  'auto_scam',
  'auto_safety',
  'legal_order',
  'grievance',
  // G2: a community manager restricted or banned a member from Members (no member report behind it).
  'staff',
] as const;
/** Automatic holds (the console's Holds section). */
export const AUTO_REPORT_SOURCES = ['auto_word', 'auto_scam', 'auto_safety'] as const;
/** Why staff lifted a ban or restriction from Members (G2); `other` needs a note. */
export const USTAAD_UNBAN_REASONS = ['sanction_served', 'mistake', 'appeal_upheld', 'other'] as const;
export type UstaadReportSource = (typeof REPORT_SOURCES)[number];
export const REPORT_REASONS = [
  'wrong_unsafe',
  'illegal_modification',
  'abuse',
  'spam',
  'privacy',
  'minor',
  'not_work',
  'fake',
  'job_scam',
  'ip',
  // F2 (security review L3): nudity, sexual content, impersonation or a morphed picture, on the person's complaint;
  // 2 h clock and the item is hidden at once pending review.
  'ncii_impersonation',
  'other',
] as const;
export type UstaadReportReason = (typeof REPORT_REASONS)[number];
/** `removal_36h` (F2): a Rule 3(1)(b) removal grievance (security review L4). */
export const REPORT_CLOCKS = [
  'intimate_2h',
  'legal_3h',
  'removal_36h',
  'standard_24h',
  'grievance_7d',
] as const;
export type UstaadReportClock = (typeof REPORT_CLOCKS)[number];
export type UstaadReportTarget = (typeof REPORT_TARGETS)[number];
export const MODERATION_ACTIONS = [
  'keep',
  'hold',
  'remove',
  'restore',
  'warn',
  'restrict',
  'ban',
  'unban',
  'strike',
  'level_review',
  'takedown',
] as const;
export const STRIKE_STATES = ['active', 'overturned', 'expired'] as const;
export const WORD_LISTS = [
  'banned',
  'scam_phrase',
  'protected',
  'pii_pattern',
  'link_domain',
  'correction',
] as const;

export const JOB_ROLES = [
  'helper',
  'mechanic_2w',
  'mechanic_4w',
  'electrician',
  'ac_technician',
  'denter_painter',
  'tyre_technician',
  'other',
] as const;

export const LOCATION_SOURCES = ['gps', 'manual'] as const;
export const COACHMARK_TARGETS = ['mic', 'create', 'like_reply', 'discover', 'pin', 'jobs'] as const;
export type CoachmarkTarget = (typeof COACHMARK_TARGETS)[number];
export const APPLICATION_LINK_STATES = ['invited', 'joined', 'closed'] as const;
export const LINK_PREVIEW_STATES = ['ok', 'blocked', 'failed'] as const;

/**
 * DPDP consents per purpose (spec 23 § 13; the plan says "8", the spec lists ten: the spec wins). Kept apart from
 * `PRIVACY_PURPOSES` so Account → Privacy does not show network consents to customers (the network is
 * mechanics-only); the `consents` CHECK accepts both lists.
 */
export const USTAAD_CONSENT_PURPOSES = [
  'ustaad_profile',
  'ustaad_directory',
  'ustaad_training',
  'ustaad_offers',
  'ustaad_location_verify',
  'ustaad_zone_count',
  'ustaad_exact_pin',
  'ustaad_voice',
  'ustaad_correction',
  'ustaad_ml_training',
] as const;
export type UstaadConsentPurpose = (typeof USTAAD_CONSENT_PURPOSES)[number];
/** The four consents asked at join; only the first is required (spec 23 flow 1). */
export const USTAAD_JOIN_CONSENTS = [
  'ustaad_profile',
  'ustaad_directory',
  'ustaad_training',
  'ustaad_offers',
] as const;
/** Version of the join consent notice; bump when the wording changes in substance. */
export const USTAAD_CONSENT_NOTICE_VERSION = 'ustaad-2026-11-26';

/** Stable error codes (spec 23 § 8). */
export const USTAAD_ERRORS = [
  'USTAAD_NOT_MEMBER',
  'USTAAD_BANNED',
  'USTAAD_RESTRICTED',
  'USTAAD_REGION',
  'USTAAD_ALREADY_MEMBER',
  'USTAAD_CANNOT_ANSWER',
  'USTAAD_DAILY_CAP',
  'USTAAD_TAG_LIMIT',
  'USTAAD_DM_NOT_ALLOWED',
  'USTAAD_EMPLOYER_REQUIRED',
  'USTAAD_SCAM_PHRASE',
  'MEDIA_TOO_LARGE',
  'MEDIA_TYPE',
  'MEDIA_TOO_LONG',
  'MEDIA_MISMATCH',
  'MEDIA_BUDGET_FULL',
  /** A video with location metadata (v1 cannot strip it): record in the app or remove the location. */
  'MEDIA_LOCATION',
  'MEDIA_QUOTA',
  'FOUR_EYES',
  'SELF_MODERATION',
  'SETTING_RANGE',
  'SETTING_RELATION',
  'SETTING_INVARIANT',
  'NAME_RESERVED',
  'USTAAD_PIN_LIMIT',
  'USTAAD_ADULT_ATTESTATION',
  'MOVED_TO_USTAAD',
  // F2 reports and moderation (spec 23 § 21f).
  'USTAAD_CONTENT_BLOCKED',
  // SIM-P15: the two blocks the author can fix get their own words (a phone number, a number plate).
  'USTAAD_CONTENT_PHONE',
  'USTAAD_CONTENT_PLATE',
  'USTAAD_REPORT_SELF',
  'USTAAD_REASON_OFF',
  'USTAAD_BAN_PENDING',
  'USTAAD_BAN_NOT_PENDING',
  'USTAAD_APPEAL_TICKET',
  'USTAAD_LEGAL_HOLD',
  'USTAAD_ACTION_INVALID',
  'STALE_REPORT',
] as const;
export type UstaadErrorCode = (typeof USTAAD_ERRORS)[number];
