import { z } from 'zod';

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
  })
  .superRefine((env, ctx) => {
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
      ? { apiKey: env.RESEND_API_KEY, domain: env.EMAIL_DOMAIN, webBaseUrl: env.WEB_BASE_URL }
      : null,
    webBaseUrl: env.WEB_BASE_URL,
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
    live: {
      transport: env.LIVE_TRANSPORT,
      databaseUrl: env.FIREBASE_DATABASE_URL ?? null,
      listenUrl: env.DATABASE_URL && !env.DATABASE_URL.includes('<') ? env.DATABASE_URL : null,
    },
    assistant: env.ANTHROPIC_API_KEY ? { apiKey: env.ANTHROPIC_API_KEY, model: env.ASSISTANT_MODEL } : null,
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
