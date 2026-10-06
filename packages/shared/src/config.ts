import { z } from 'zod';

/** Environment configuration. Validated at start-up so a bad deployment fails fast (never at first request). */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().min(1).default('pglite://./var/db'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),
  DEFAULT_TENANT_SLUG: z.string().min(1).default('meridian-demo'),
  /** Login/forgot-password attempts per client per 15 minutes. Raised only by the automated e2e suite. */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(100000).default(10),
  STORAGE_DIR: z.string().min(1).default('./var/storage'),
  /** Key for the local secret store (SEC-N03). Required in production; development and test derive it from SESSION_SECRET. */
  SECRET_STORE_KEY: z.string().min(32, 'SECRET_STORE_KEY must be at least 32 characters').optional(),
  AI_PROVIDER: z.enum(['mock']).default('mock'),
  IDENTITY_PROVIDER: z.enum(['mock']).default('mock'),
});
export type AppConfig = z.infer<typeof envSchema>;

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n - ${issues.join('\n - ')}`);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Report variable names and reasons only - never the offending values (they may be secrets).
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
  }
  return parsed.data;
}
