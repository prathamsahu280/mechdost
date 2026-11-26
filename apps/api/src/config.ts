import { z } from 'zod';
import { DEFAULT_ANTHROPIC_CORRECTION_MODEL } from './ustaad/correction/anthropic';

/**
 * API configuration, validated once at boot (fail fast). Every variable is documented in `.env.example`.
 * Production refuses unsafe setups: no in-memory rate limiting (rule 7: no single-server assumptions),
 * no Firebase emulator, explicit CORS origins.
 */
const csv = z
  .string()
  .default('')
  .transform((s) =>
    s
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    DATABASE_POOL_URL: z.string().min(1),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),
    CORS_ORIGINS: csv,
    FIREBASE_PROJECT_ID: z.string().default('demo-mechdost'),
    FIREBASE_AUTH_EMULATOR_HOST: z.string().optional(),
    /** Service-account key file, local development only (outside the repo); production uses Cloud Run identity. */
    GOOGLE_APPLICATION_CREDENTIALS: z.string().min(1).optional(),
    /** Web API key of the Firebase project: the API checks passwords with it (spec 01). Not a secret by itself. */
    FIREBASE_API_KEY: z.string().min(10).optional(),
    /** Cloudflare Turnstile secret; development may use Cloudflare's always-pass test secret. */
    TURNSTILE_SECRET_KEY: z.string().min(10).optional(),
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    /** Proxies in front of the API that append to X-Forwarded-For (Cloud Run LB = 1, + Cloudflare = 2). */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    /** Set by Cloud Run on every service; used only to refuse a non-production NODE_ENV there (review C3). */
    K_SERVICE: z.string().optional(),
    API_DOCS: z.enum(['on', 'off']).optional(),
    ANTHROPIC_API_KEY: z.string().min(20).optional(),
    ASSISTANT_MODEL: z.string().default('claude-opus-5-5'),
    /** Customer assistant chat (spec 18). Off unless `true`, even with ANTHROPIC_API_KEY set (founder 2026-11-26: off for now). */
    ASSISTANT_ENABLED: z.enum(['true', 'false']).default('false'),
    /**
     * Ustaad smart correction (spec 23 § 11, Q-U3): `none` (default) = the word list on our server only. The assistant's
     * ANTHROPIC_API_KEY alone never switches it on: member text goes to an LLM only when this names a provider.
     */
    SMART_CORRECTION_PROVIDER: z.enum(['anthropic', 'gemini', 'none']).default('none'),
    /** Model id; default claude-haiku-5-5 for anthropic, required for gemini. */
    SMART_CORRECTION_MODEL: z.string().trim().min(1).max(100).optional(),
    GEMINI_API_KEY: z.string().min(20).optional(),
    /** Live updates transport (decision 2026-11-01): polling (no push) or rtdb (Firebase Realtime Database). */
    LIVE_TRANSPORT: z.enum(['polling', 'rtdb']).default('polling'),
    FIREBASE_DATABASE_URL: z.url().optional(),
    /** Session-mode connection for the relay's LISTEN wake-up (port 5432); optional, the 1 s sweep is the backstop. */
    DATABASE_URL: z.string().optional(),
    /** WhatsApp via the Meta Cloud API directly (decision 2026-11-02). Off until the Meta account is ready. */
    /** Razorpay (plan 2026-11-12): online payment is offered only when key id + secret are set. */
    RAZORPAY_KEY_ID: z
      .string()
      .regex(/^rzp_(test|live)_[A-Za-z0-9]{8,32}$/)
      .optional(),
    RAZORPAY_KEY_SECRET: z.string().min(16).max(64).optional(),
    /** Webhook secret (Razorpay Dashboard → Webhooks); the webhook route answers 404 until it is set. */
    RAZORPAY_WEBHOOK_SECRET: z.string().min(8).max(128).optional(),
    /** Pre-launch testing only (user 2026-11-14): lets production start with `rzp_test_` keys. Remove before real customers. */
    RAZORPAY_ALLOW_TEST_KEYS: z.enum(['true', 'false']).optional(),
    /** Email through Resend (plan 2026-11-13): sending is on when the key is set. */
    RESEND_API_KEY: z
      .string()
      .regex(/^re_[A-Za-z0-9_]{20,}$/)
      .optional(),
    /** Sender domain: updates@, billing@, support@ (reply-to), promotions@, noreply@ (decision 2026-11-13). */
    EMAIL_DOMAIN: z
      .string()
      .regex(/^[a-z0-9-]+(\.[a-z0-9-]+)+$/)
      .default('mechdost.com'),
    /** The website origin, for links in emails. */
    WEB_BASE_URL: z.url().default('http://localhost:3000'),
    /** Grievance officer contact shown in the email footer; the line stays hidden while this is unset (Q15b). */
    EMAIL_GRIEVANCE_CONTACT: z.string().trim().min(3).max(200).optional(),
    /**
     * Shared secret with the website's `/api/revalidate` route: after staff publish content, the API asks the website
     * to refresh what it cached by tag (design 2026-11-15 items 5, 6, 8). Unset = the website refreshes within 60 s.
     */
    REVALIDATE_SECRET: z.string().trim().min(32).max(200).optional(),
    /** HMAC key for Ustaad WhatsApp share teaser links (spec 23 § 10 step 7). Unset = sharing answers 503. */
    USTAAD_SHARE_SECRET: z.string().trim().min(32).max(200).optional(),
    /** Ustaad distance bands (spec 23 SR-29): HMAC key for the stable per-pair noise; unset = Discover shows no bands. */
    USTAAD_LOCATION_SECRET: z.string().trim().min(32).max(200).optional(),
    WHATSAPP_ENABLED: z.enum(['on', 'off']).default('off'),
    WHATSAPP_PHONE_NUMBER_ID: z
      .string()
      .regex(/^\d{5,20}$/)
      .optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().min(20).optional(),
    WHATSAPP_APP_SECRET: z.string().min(16).optional(),
    WHATSAPP_VERIFY_TOKEN: z.string().min(16).optional(),
    /**
     * City used when a request carries none: catalogue reads without `city`, ticket codes from WhatsApp when the
     * sender's city is unknown (code segment only). Launch city Raipur.
     */
    DEFAULT_CITY_CODE: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('RPR'),
    WHATSAPP_API_VERSION: z
      .string()
      .regex(/^v\d{2}\.\d$/)
      .default('v23.0'),
    /** Sentry error reports (decision 2026-11-14): off until the DSN is set. Same DSN for the API and the worker. */
    SENTRY_DSN: z
      .string()
      .regex(
        /^https:\/\/[A-Za-z0-9]{16,64}@[a-z0-9.-]+(:\d{2,5})?\/\d{1,20}$/,
        'a Sentry DSN (https://<key>@<host>/<id>)',
      )
      .optional(),
    /** Environment name shown in Sentry; defaults to NODE_ENV. */
    SENTRY_ENVIRONMENT: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,31}$/)
      .optional(),
    /** Release (the deployed commit, set from IMAGE_TAG by deploy/compose.yml) so issues show which build broke. */
    SENTRY_RELEASE: z
      .string()
      .regex(/^[A-Za-z0-9._-]{1,64}$/)
      .optional(),
    /**
     * Admin → Errors (decision 2026-11-14): a read-only Sentry token (`event:read`, `project:read`, `org:read`;
     * never the CI upload token) and the org/project slugs. The panel shows "not connected" until all are set.
     */
    SENTRY_API_TOKEN: z
      .string()
      .regex(/^[A-Za-z0-9_=+./-]{32,400}$/)
      .optional(),
    SENTRY_ORG: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,49}$/)
      .optional(),
    SENTRY_PROJECT_WEB: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,99}$/)
      .optional(),
    SENTRY_PROJECT_API: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{0,99}$/)
      .optional(),
    /** Sentry's API for the org's data region (EU: de.sentry.io, decision 2026-11-14). */
    SENTRY_REGION_URL: z
      .string()
      .regex(/^https:\/\/([a-z0-9-]+\.)*sentry\.io\/?$/, 'https://<region>.sentry.io')
      .default('https://de.sentry.io'),
    /** PostHog project API key (`phc_…`, decision 2026-11-14): the worker forwards consented events; off when unset. */
    POSTHOG_KEY: z
      .string()
      .regex(/^phc_[A-Za-z0-9]{20,80}$/, 'a PostHog project API key (phc_…)')
      .optional(),
    /**
     * Supabase Storage for job photos (design 2026-11-15): the project URL and the SECRET key (server only, never sent
     * to a browser). A placeholder or empty value counts as unset: photo routes then answer 503 PHOTOS_UNAVAILABLE.
     */
    SUPABASE_URL: z
      .string()
      .optional()
      .transform((v) =>
        v && /^https:\/\/[a-z0-9]{8,40}\.supabase\.co\/?$/.test(v.trim())
          ? v.trim().replace(/\/$/, '')
          : undefined,
      ),
    SUPABASE_SECRET_KEY: z
      .string()
      .optional()
      .transform((v) => (v && v.trim().length >= 20 && !v.includes('<') ? v.trim() : undefined)),
    /**
     * Ustaad Network media (spec 23 § 10; Q-U1): `supabase` (default) or `r2`. R2 needs every `R2_*` value; a missing
     * one falls back to Supabase with a warning. Supabase uses SUPABASE_URL / SUPABASE_SECRET_KEY above.
     */
    MEDIA_HOST: z.enum(['supabase', 'r2']).default('supabase'),
    R2_ACCOUNT_ID: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional()
      .catch(undefined),
    R2_ACCESS_KEY_ID: z.string().min(16).optional().catch(undefined),
    R2_SECRET_ACCESS_KEY: z.string().min(32).optional().catch(undefined),
    R2_BUCKET_QUARANTINE: z.string().default('ustaad-quarantine'),
    R2_BUCKET_MEDIA: z.string().default('ustaad-media'),
    R2_BUCKET_DOCS: z.string().default('ustaad-docs'),
    R2_BUCKET_EVIDENCE: z.string().default('ustaad-evidence'),
    /** Public host of the media bucket (CSP img-src / media-src) and of the docs bucket (downloads only, SR-16). */
    R2_MEDIA_HOST: z.string().optional(),
    R2_DOCS_HOST: z.string().optional(),
    /** The Supabase project's per-file upload limit in MB (free plan 50); caps are clamped to it. */
    SUPABASE_MAX_UPLOAD_MB: z.coerce.number().int().min(5).max(5000).default(50),
    /** PostHog ingestion host; EU cloud by default (decision 2026-11-14). */
    POSTHOG_HOST: z.url().default('https://eu.i.posthog.com'),
    /** Megabytes of public product-photo bytes kept in memory (0 = off; capped so it fits the container, decision 2026-11-24). */ PHOTO_CACHE_MB:
      z.coerce.number().int().min(0).max(128).default(64),
  })
  .superRefine((env, ctx) => {
    if (env.SMART_CORRECTION_PROVIDER === 'gemini' && !env.SMART_CORRECTION_MODEL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMART_CORRECTION_MODEL'],
        message: 'required when SMART_CORRECTION_PROVIDER=gemini',
      });
    }
    if (env.DATABASE_POOL_URL.includes('<')) {
      ctx.addIssue({ code: 'custom', path: ['DATABASE_POOL_URL'], message: 'still a placeholder' });
    }
    if (env.LIVE_TRANSPORT === 'rtdb') {
      const url = env.FIREBASE_DATABASE_URL ?? '';
      if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebasedatabase\.app|firebaseio\.com)\/?$/.test(url)) {
        ctx.addIssue({
          code: 'custom',
          path: ['FIREBASE_DATABASE_URL'],
          message: 'https://<db>.<region>.firebasedatabase.app required for LIVE_TRANSPORT=rtdb',
        });
      }
    }
    if (env.WHATSAPP_ENABLED === 'on') {
      const needed = [
        'WHATSAPP_PHONE_NUMBER_ID',
        'WHATSAPP_ACCESS_TOKEN',
        'WHATSAPP_APP_SECRET',
        'WHATSAPP_VERIFY_TOKEN',
      ] as const;
      for (const key of needed) {
        if (!env[key])
          ctx.addIssue({ code: 'custom', path: [key], message: 'required when WHATSAPP_ENABLED=on' });
      }
    }
    if (env.K_SERVICE && env.NODE_ENV !== 'production') {
      ctx.addIssue({
        code: 'custom',
        path: ['NODE_ENV'],
        message:
          'must be production on Cloud Run (K_SERVICE is set); development skips every production check',
      });
    }
    if (Boolean(env.RAZORPAY_KEY_ID) !== Boolean(env.RAZORPAY_KEY_SECRET)) {
      ctx.addIssue({
        code: 'custom',
        path: [env.RAZORPAY_KEY_ID ? 'RAZORPAY_KEY_SECRET' : 'RAZORPAY_KEY_ID'],
        message: 'Razorpay needs both the key id and the key secret',
      });
    }
    if (env.NODE_ENV !== 'production') return;
    if (env.POSTHOG_KEY && !env.POSTHOG_HOST.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['POSTHOG_HOST'], message: 'https required in production' });
    }
    if (!env.WEB_BASE_URL.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['WEB_BASE_URL'], message: 'https required in production' });
    }
    if (env.RAZORPAY_KEY_ID?.startsWith('rzp_test_') && env.RAZORPAY_ALLOW_TEST_KEYS !== 'true') {
      ctx.addIssue({
        code: 'custom',
        path: ['RAZORPAY_KEY_ID'],
        message: 'test keys are not allowed in production',
      });
    }
    // Without the webhook, a payment whose browser closed before the callback is never confirmed or flagged
    // (final review 2026-11-12, finding 5).
    if (env.RAZORPAY_KEY_ID && !env.RAZORPAY_WEBHOOK_SECRET) {
      ctx.addIssue({
        code: 'custom',
        path: ['RAZORPAY_WEBHOOK_SECRET'],
        message: 'required in production when Razorpay keys are set',
      });
    }
    if (env.TRUSTED_PROXY_HOPS < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['TRUSTED_PROXY_HOPS'],
        message:
          'at least 1 in production (Cloud Run load balancer), else every user shares one rate-limit bucket',
      });
    }
    const required = [
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'FIREBASE_API_KEY',
      'TURNSTILE_SECRET_KEY',
    ] as const;
    for (const key of required) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
    }
    // The AWS server has no automatic Google credentials (Q93, 2026-11-14): firebase-admin needs the project's
    // service-account key for revocation checks, sign-in tokens and the Realtime Database — only as a file mounted
    // read-only under /run/secrets (compose), never baked into an image or the repository.
    const key = env.GOOGLE_APPLICATION_CREDENTIALS;
    if (key && !/^\/run\/secrets\/[\w.-]+\.json$/.test(key)) {
      ctx.addIssue({
        code: 'custom',
        path: ['GOOGLE_APPLICATION_CREDENTIALS'],
        message: 'in production, only a key file mounted under /run/secrets/',
      });
    }
    if (env.FIREBASE_AUTH_EMULATOR_HOST) {
      ctx.addIssue({
        code: 'custom',
        path: ['FIREBASE_AUTH_EMULATOR_HOST'],
        message: 'must be unset in production',
      });
    }
    if (env.FIREBASE_PROJECT_ID.startsWith('demo-')) {
      ctx.addIssue({ code: 'custom', path: ['FIREBASE_PROJECT_ID'], message: 'real project id required' });
    }
    if (env.CORS_ORIGINS.length === 0 || env.CORS_ORIGINS.some((o) => !o.startsWith('https://'))) {
      ctx.addIssue({
        code: 'custom',
        path: ['CORS_ORIGINS'],
        message: 'https origins required in production',
      });
    }
  });

export type Config = ReturnType<typeof toConfig>;

function toConfig(env: z.infer<typeof schema>) {
  return {
    env: env.NODE_ENV,
    port: env.PORT,
    databaseUrl: env.DATABASE_POOL_URL,
    databasePoolMax: env.DATABASE_POOL_MAX,
    corsOrigins: env.CORS_ORIGINS,
    firebaseProjectId: env.FIREBASE_PROJECT_ID,
    usingAuthEmulator: Boolean(env.FIREBASE_AUTH_EMULATOR_HOST),
    authEmulatorHost: env.FIREBASE_AUTH_EMULATOR_HOST ?? null,
    firebaseApiKey: env.FIREBASE_API_KEY ?? null,
    firebaseKeyFile: env.GOOGLE_APPLICATION_CREDENTIALS ?? null,
    turnstileSecret: env.TURNSTILE_SECRET_KEY ?? null,
    upstash:
      env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
        ? { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }
        : null,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS,
    apiDocs: env.API_DOCS ? env.API_DOCS === 'on' : env.NODE_ENV !== 'production',
    razorpay:
      env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET
        ? {
            keyId: env.RAZORPAY_KEY_ID,
            keySecret: env.RAZORPAY_KEY_SECRET,
            webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? null,
            /** Test keys: payments are free and fake. Logged loudly at start-up in production. */
            testMode: env.RAZORPAY_KEY_ID.startsWith('rzp_test_'),
          }
        : null,
    email: env.RESEND_API_KEY
      ? {
          apiKey: env.RESEND_API_KEY,
          domain: env.EMAIL_DOMAIN,
          webBaseUrl: env.WEB_BASE_URL,
          grievanceContact: env.EMAIL_GRIEVANCE_CONTACT ?? null,
        }
      : null,
    webBaseUrl: env.WEB_BASE_URL,
    revalidateSecret: env.REVALIDATE_SECRET ?? null,
    ustaadShareSecret: env.USTAAD_SHARE_SECRET ?? null,
    ustaadLocationSecret: env.USTAAD_LOCATION_SECRET ?? null,
    whatsapp:
      env.WHATSAPP_ENABLED === 'on' &&
      env.WHATSAPP_PHONE_NUMBER_ID &&
      env.WHATSAPP_ACCESS_TOKEN &&
      env.WHATSAPP_APP_SECRET &&
      env.WHATSAPP_VERIFY_TOKEN
        ? {
            phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
            accessToken: env.WHATSAPP_ACCESS_TOKEN,
            appSecret: env.WHATSAPP_APP_SECRET,
            verifyToken: env.WHATSAPP_VERIFY_TOKEN,
            apiVersion: env.WHATSAPP_API_VERSION,
          }
        : null,
    defaultCityCode: env.DEFAULT_CITY_CODE,
    /** Private Storage bucket for job photos; null = photos unavailable (503), everything else works. */
    photoCacheBytes: env.PHOTO_CACHE_MB * 1024 * 1024,
    photoStorage:
      env.SUPABASE_URL && env.SUPABASE_SECRET_KEY
        ? { url: env.SUPABASE_URL, secretKey: env.SUPABASE_SECRET_KEY, bucket: 'service-photos' }
        : null,
    ustaadMedia: {
      host: env.MEDIA_HOST,
      buckets: {
        quarantine: env.R2_BUCKET_QUARANTINE,
        media: env.R2_BUCKET_MEDIA,
        docs: env.R2_BUCKET_DOCS,
        evidence: env.R2_BUCKET_EVIDENCE,
      },
      r2:
        env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY
          ? {
              accountId: env.R2_ACCOUNT_ID,
              credentials: { accessKeyId: env.R2_ACCESS_KEY_ID, secretAccessKey: env.R2_SECRET_ACCESS_KEY },
            }
          : null,
      supabase:
        env.SUPABASE_URL && env.SUPABASE_SECRET_KEY
          ? {
              url: env.SUPABASE_URL,
              secretKey: env.SUPABASE_SECRET_KEY,
              maxFileBytes: env.SUPABASE_MAX_UPLOAD_MB * 1024 * 1024,
            }
          : null,
    },
    live: {
      transport: env.LIVE_TRANSPORT,
      databaseUrl: env.FIREBASE_DATABASE_URL ?? null,
      listenUrl: env.DATABASE_URL && !env.DATABASE_URL.includes('<') ? env.DATABASE_URL : null,
    },
    assistant:
      env.ANTHROPIC_API_KEY && env.ASSISTANT_ENABLED === 'true'
        ? { apiKey: env.ANTHROPIC_API_KEY, model: env.ASSISTANT_MODEL }
        : null,
    /** Smart-correction LLM; null = word list only (no provider named, or its key missing). */
    smartCorrection: smartCorrectionConfig(env),
    /** Error reports to Sentry; null = off (nothing loaded, nothing sent). */
    sentry: env.SENTRY_DSN
      ? {
          dsn: env.SENTRY_DSN,
          environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
          release: env.SENTRY_RELEASE ?? null,
        }
      : null,
    /** Read-only Sentry issues for Admin → Errors; null = "not connected". */
    sentryIssues:
      env.SENTRY_API_TOKEN && env.SENTRY_ORG && (env.SENTRY_PROJECT_WEB || env.SENTRY_PROJECT_API)
        ? {
            token: env.SENTRY_API_TOKEN,
            org: env.SENTRY_ORG,
            projects: {
              web: env.SENTRY_PROJECT_WEB ?? null,
              api: env.SENTRY_PROJECT_API ?? null,
            },
            baseUrl: env.SENTRY_REGION_URL.replace(/\/+$/, ''),
            environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
          }
        : null,
    /** Consented events forwarded to PostHog by the worker; null = off. */
    posthog: env.POSTHOG_KEY ? { key: env.POSTHOG_KEY, host: env.POSTHOG_HOST.replace(/\/+$/, '') } : null,
  };
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid API configuration:\n  ${issues.join('\n  ')}`);
    this.name = 'ConfigError';
  }
}

/** Parse environment variables. Error messages name the variable, never its value (no secret leaks). */
export function loadConfig(source: Record<string, string | undefined>): Config {
  // `.env` lines like `UPSTASH_REDIS_REST_URL=` mean "not set", not "set to an empty string".
  const present = Object.fromEntries(
    Object.entries(source).filter(([, v]) => v !== undefined && v.trim() !== ''),
  );
  const parsed = schema.safeParse(present);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return toConfig(parsed.data);
}

function smartCorrectionConfig(env: {
  SMART_CORRECTION_PROVIDER: 'anthropic' | 'gemini' | 'none';
  SMART_CORRECTION_MODEL?: string | undefined;
  ANTHROPIC_API_KEY?: string | undefined;
  GEMINI_API_KEY?: string | undefined;
}): { provider: 'anthropic' | 'gemini'; apiKey: string; model: string } | null {
  if (env.SMART_CORRECTION_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY)
    return {
      provider: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.SMART_CORRECTION_MODEL ?? DEFAULT_ANTHROPIC_CORRECTION_MODEL,
    };
  if (env.SMART_CORRECTION_PROVIDER === 'gemini' && env.GEMINI_API_KEY && env.SMART_CORRECTION_MODEL)
    return { provider: 'gemini', apiKey: env.GEMINI_API_KEY, model: env.SMART_CORRECTION_MODEL };
  return null;
}
