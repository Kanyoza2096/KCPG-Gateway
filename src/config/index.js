'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });

const { z } = require('zod');

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3100),
  NODE_ENV: z.enum(['development', 'staging', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  PYTHON_CORE_BASE_URL: z.string().url().default('http://127.0.0.1:10000'),
  PYTHON_SERVICE_TOKEN: z.string().optional(),
  KCPG_CONTEXT_SIGNING_SECRET: z.string().optional(),
  IDENTITY_EXCHANGE_ENABLED: z.string().transform((v) => v === 'true' || v === '1').default('true'),
  PROXY_ENABLED: z.string().transform((v) => v === 'true' || v === '1').default('false'),
  VERSION: z.string().default('0.6.0'),
  COOKIE_SAME_SITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(2).default(0),

  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  REDIS_EVENT_CHANNEL: z.string().default('kanyoza:events'),
  REDIS_REQUIRED: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),

  JWT_SECRET: z.string().min(16).default('dev-jwt-secret-change-in-production'),
  JWT_ISSUER: z.string().optional().default(''),
  JWT_AUDIENCE: z.string().default('kcpg'),
  AUTH_DISABLED: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),


  CORS_ORIGINS: z
    .string()
    .default('http://localhost:5173,http://localhost:3000')
    .transform((s) =>
      s
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean)
    ),

  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  OVERVIEW_CACHE_TTL_MS: z.coerce.number().int().positive().default(3_000),
  METRICS_SCRAPE_TOKEN: z.string().optional(),

  // Canonical: KCPG_EVENT_SIGNING_SECRET. Accept legacy PYTHON_EVENT_SIGNING_SECRET alias.
  KCPG_EVENT_SIGNING_SECRET: z.string().optional(),
  PYTHON_EVENT_SIGNING_SECRET: z.string().optional(),

  EVENT_MAX_SKEW_MS: z.coerce.number().int().positive().default(300_000),
  REQUIRE_EVENT_SIGNATURE: z.string().transform((v) => v === 'true' || v === '1').default('false'),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;

const serviceToken = (env.PYTHON_SERVICE_TOKEN || '').trim();

if (env.NODE_ENV === 'production') {
  if (env.JWT_SECRET.includes('change') || env.JWT_SECRET.includes('dev-')) {
    console.error('JWT_SECRET must be set to a strong secret in production');
    process.exit(1);
  }
  if (!serviceToken || serviceToken.length < 32) {
    console.error('PYTHON_SERVICE_TOKEN must be set to a strong service credential in production');
    process.exit(1);
  }
  if (!(env.KCPG_CONTEXT_SIGNING_SECRET || '').trim() || env.KCPG_CONTEXT_SIGNING_SECRET.trim().length < 32) {
    console.error('KCPG_CONTEXT_SIGNING_SECRET must be set to a strong shared context-signing secret in production');
    process.exit(1);
  }
  if (env.PROXY_ENABLED) {
    console.error('PROXY_ENABLED must remain false in production; use the explicit BFF/command routes');
    process.exit(1);
  }
  if (env.COOKIE_SAME_SITE !== 'none') {
    console.error('COOKIE_SAME_SITE must be none in production for cross-site control-plane deployments');
    process.exit(1);
  }
  // NOTE: the wildcard-CORS guard was removed to allow development and
  // integration debugging against rotating Cloudflare Pages preview URLs.
  // See middleware/cors.js and middleware/originGuard.js — both honor the
  // '*' wildcard. Restore the guard before onboarding real users:
  //
  //   if (env.CORS_ORIGINS.includes('*')) {
  //     console.error('Wildcard CORS is not allowed in production');
  //     process.exit(1);
  //   }
  //
  if (!env.METRICS_SCRAPE_TOKEN || env.METRICS_SCRAPE_TOKEN.length < 32) {
    console.error('METRICS_SCRAPE_TOKEN must be set to a strong credential in production');
    process.exit(1);
  }

  const signingSecretProd = (env.KCPG_EVENT_SIGNING_SECRET || env.PYTHON_EVENT_SIGNING_SECRET || '').trim();
  if (!signingSecretProd || signingSecretProd.length < 32) {
    console.error('KCPG_EVENT_SIGNING_SECRET (or PYTHON_EVENT_SIGNING_SECRET) must be set to a strong credential in production');
    process.exit(1);
  }

  if (!env.REQUIRE_EVENT_SIGNATURE) {
    console.error('REQUIRE_EVENT_SIGNATURE must be true in production');
    process.exit(1);
  }
  if (env.AUTH_DISABLED) {
    console.error('AUTH_DISABLED cannot be true in production');
    process.exit(1);
  }
}

module.exports = {
  version: env.VERSION,
  port: env.PORT,
  nodeEnv: env.NODE_ENV,
  logLevel: env.LOG_LEVEL,
  isProd: env.NODE_ENV === 'production',
  isDev: env.NODE_ENV === 'development',

  python: {
    baseUrl: env.PYTHON_CORE_BASE_URL.replace(/\/$/, ''),
    serviceToken,
    contextSigningSecret: (env.KCPG_CONTEXT_SIGNING_SECRET || '').trim(),
    identityExchangeEnabled: env.IDENTITY_EXCHANGE_ENABLED,
  },

  redis: {
    url: env.REDIS_URL,
    eventChannel: env.REDIS_EVENT_CHANNEL,
    required: env.REDIS_REQUIRED,
  },

  auth: {
    jwtSecret: env.JWT_SECRET,
    issuer: env.JWT_ISSUER || undefined,
    audience: env.JWT_AUDIENCE,
    disabled: env.AUTH_DISABLED,
  },

  corsOrigins: env.CORS_ORIGINS,
  cookie: { sameSite: env.COOKIE_SAME_SITE },

  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
  },

  cache: {
    overviewTtlMs: env.OVERVIEW_CACHE_TTL_MS,
    enabled: env.NODE_ENV !== 'production',
  },

  proxy: {
    enabled: env.PROXY_ENABLED,
  },

  trustProxy: env.TRUST_PROXY,

  metrics: {
    scrapeToken: (env.METRICS_SCRAPE_TOKEN || '').trim(),
  },

  events: {
    signingSecret: (env.KCPG_EVENT_SIGNING_SECRET || env.PYTHON_EVENT_SIGNING_SECRET || '').trim(),
    maxSkewMs: env.EVENT_MAX_SKEW_MS,
    requireSignature: env.REQUIRE_EVENT_SIGNATURE,
  },
};
