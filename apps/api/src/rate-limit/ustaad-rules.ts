/**
 * Rate rules for every Ustaad route family of spec 23 § 8 (SR-43): per member unless the name says IP. Workstreams
 * B–G use these constants (never inline numbers); 429 answers carry `Retry-After` and the RateLimit headers. Daily
 * caps that are admin settings (`posts.per_day`, `limits.*`) are checked in the repositories as well.
 */
import type { RateRule } from './limiter';

const H = 3600;
const DAY = 86_400;

export const USTAAD_RATE_RULES = {
  // Membership (A)
  membershipWrites: { name: 'ustaad_member_writes', limit: 30, windowSeconds: 600 },
  join: { name: 'ustaad_join', limit: 3, windowSeconds: DAY },
  memberReads: { name: 'ustaad_member_reads', limit: 120, windowSeconds: 60 },
  // Verification (B)
  vouches: { name: 'ustaad_vouches', limit: 5, windowSeconds: DAY },
  attestPerIp: { name: 'ustaad_attest_ip', limit: 10, windowSeconds: H },
  workshopAttest: { name: 'ustaad_workshop_attest', limit: 60, windowSeconds: 600 },
  // Media (A)
  mediaUploads: { name: 'ustaad_media_uploads', limit: 40, windowSeconds: DAY },
  mediaVideos: { name: 'ustaad_media_videos', limit: 3, windowSeconds: DAY },
  mediaReadsPerIp: { name: 'ustaad_media_reads_ip', limit: 600, windowSeconds: 60 },
  // Feed and posts (D)
  posts: { name: 'ustaad_posts', limit: 20, windowSeconds: DAY },
  comments: { name: 'ustaad_comments', limit: 30, windowSeconds: H },
  likes: { name: 'ustaad_likes', limit: 100, windowSeconds: DAY },
  stories: { name: 'ustaad_stories', limit: 10, windowSeconds: DAY },
  // Q&A (C)
  questions: { name: 'ustaad_questions', limit: 10, windowSeconds: DAY },
  answers: { name: 'ustaad_answers', limit: 30, windowSeconds: DAY },
  votes: { name: 'ustaad_votes', limit: 100, windowSeconds: DAY },
  // Graph, mentorship, messages (D)
  follows: { name: 'ustaad_follows', limit: 20, windowSeconds: DAY },
  connects: { name: 'ustaad_connects', limit: 20, windowSeconds: DAY },
  mentorships: { name: 'ustaad_mentorships', limit: 5, windowSeconds: DAY },
  newThreads: { name: 'ustaad_new_threads', limit: 20, windowSeconds: DAY },
  messages: { name: 'ustaad_messages', limit: 120, windowSeconds: H },
  // Discover (D)
  search: { name: 'ustaad_search', limit: 60, windowSeconds: 60 },
  profileViews: { name: 'ustaad_profile_views', limit: 200, windowSeconds: DAY },
  // Location and jobs (E)
  location: { name: 'ustaad_location', limit: 10, windowSeconds: DAY },
  jobs: { name: 'ustaad_jobs', limit: 5, windowSeconds: DAY },
  applications: { name: 'ustaad_applications', limit: 20, windowSeconds: DAY },
  // Learn (C), correction and reports (F)
  learn: { name: 'ustaad_learn', limit: 120, windowSeconds: H },
  correction: { name: 'ustaad_correction', limit: 30, windowSeconds: 600 },
  reports: { name: 'ustaad_reports', limit: 20, windowSeconds: DAY },
  // Share teaser (D), staff (G)
  sharePerIp: { name: 'ustaad_share_ip', limit: 60, windowSeconds: 60 },
  staff: { name: 'ustaad_staff', limit: 300, windowSeconds: 60 },
} as const satisfies Record<string, RateRule>;

export type UstaadRateRuleKey = keyof typeof USTAAD_RATE_RULES;
