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

  CONTROL_PLANE_EMAIL: z.string().email().optional(),
  CONTROL_PLANE_PASSWORD_HASH: z.string().optional(),
  CONTROL_PLANE_ROLE: z.enum(['viewer', 'operator', 'admin']).default('operator'),
  CONTROL_PLANE_SCOPES: z.string().default('control.read,control.write,engine.read,engine.control,council.read,council.vote,workflow.read,workflow.execute,security.read,security.respond,diagnostics.read,diagnostics.execute,configuration.read'),
  CONTROL_PLANE_WORKSPACES: z.string().default(''),

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
  if (env.PROXY_ENABLED) {
    console.error('PROXY_ENABLED must remain false in production; use the explicit BFF/command routes');
    process.exit(1);
  }
  if (env.COOKIE_SAME_SITE !== 'none') {
    console.error('COOKIE_SAME_SITE must be none in production for cross-site control-plane deployments');
    process.exit(1);
  }
  if (env.CORS_ORIGINS.includes('*')) {
    console.error('Wildcard CORS is not allowed in production');
    process.exit(1);
  }
  if (!env.METRICS_SCRAPE_TOKEN || env.METRICS_SCRAPE_TOKEN.length < 32) {
    console.error('METRICS_SCRAPE_TOKEN must be set to a strong credential in production');
    process.exit(1);
  }
  if (!env.CONTROL_PLANE_EMAIL || !env.CONTROL_PLANE_PASSWORD_HASH) {
    console.error('CONTROL_PLANE_EMAIL and CONTROL_PLANE_PASSWORD_HASH must be configured in production');
    process.exit(1);
  }
  if (!env.CONTROL_PLANE_WORKSPACES.split(',').map((s) => s.trim()).filter(Boolean).length) {
    console.error('CONTROL_PLANE_WORKSPACES must list at least one authorized workspace in production');
    process.exit(1);
  }
  if (!env.PYTHON_EVENT_SIGNING_SECRET || env.PYTHON_EVENT_SIGNING_SECRET.length < 32) {
    console.error('PYTHON_EVENT_SIGNING_SECRET must be set to a strong credential in production');
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
    identityExchangeEnabled: env.IDENTITY_EXCHANGE_ENABLED,
  },

  redis: {
    url: env.REDIS_URL,
    eventChannel: env.REDIS_EVENT_CHANNEL,
    required: env.REDIS_REQUIRED,
  },

  auth: {
    jwtSecret: env.JWT_SECRET,
    controlPlaneEmail: env.CONTROL_PLANE_EMAIL || '',
    controlPlanePasswordHash: env.CONTROL_PLANE_PASSWORD_HASH || '',
    controlPlaneRole: env.CONTROL_PLANE_ROLE,
    controlPlaneScopes: env.CONTROL_PLANE_SCOPES.split(',').map((s) => s.trim()).filter(Boolean),
    controlPlaneWorkspaces: env.CONTROL_PLANE_WORKSPACES.split(',').map((s) => s.trim()).filter(Boolean),
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
    signingSecret: (env.PYTHON_EVENT_SIGNING_SECRET || '').trim(),
    maxSkewMs: env.EVENT_MAX_SKEW_MS,
    requireSignature: env.REQUIRE_EVENT_SIGNATURE,
  },
};
