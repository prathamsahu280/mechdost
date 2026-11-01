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
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    /** Proxies in front of the API that append to X-Forwarded-For (Cloud Run LB = 1, + Cloudflare = 2). */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    API_DOCS: z.enum(['on', 'off']).optional(),
    ANTHROPIC_API_KEY: z.string().min(20).optional(),
    ASSISTANT_MODEL: z.string().default('claude-opus-5-5'),
    /** Live updates transport (decision 2026-11-01): polling (no push) or rtdb (Firebase Realtime Database). */
    LIVE_TRANSPORT: z.enum(['polling', 'rtdb']).default('polling'),
    FIREBASE_DATABASE_URL: z.url().optional(),
    /** Session-mode connection for the relay's LISTEN wake-up (port 5432); optional, the 1 s sweep is the backstop. */
    DATABASE_URL: z.string().optional(),
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
    if (env.NODE_ENV !== 'production') return;
    const required = ['UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'] as const;
    for (const key of required) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' });
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
    upstash:
      env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN
        ? { url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN }
        : null,
    trustedProxyHops: env.TRUSTED_PROXY_HOPS,
    apiDocs: env.API_DOCS ? env.API_DOCS === 'on' : env.NODE_ENV !== 'production',
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
