import { z } from 'zod';

const schema = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_URL_UNPOOLED: z.string().min(1).optional(),
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().url(),
  APP_URL: z.string().url(),
  COOKIE_DOMAIN: z.string().optional(),
  TRUSTED_ORIGINS: z.string().optional(),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  UPSTASH_REDIS_REST_URL: z.string().optional(),
  UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = Omit<z.infer<typeof schema>, 'TRUSTED_ORIGINS'> & {
  TRUSTED_ORIGINS: string[];
};

export function parseEnv(input: Record<string, string | undefined>): Env {
  const parsed = schema.parse(input);
  const origins = parsed.TRUSTED_ORIGINS
    ? parsed.TRUSTED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean)
    : [parsed.APP_URL];
  return { ...parsed, TRUSTED_ORIGINS: origins };
}

export const env = parseEnv(process.env);
