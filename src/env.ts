import { createEnv } from '@t3-oss/env-nextjs';
import * as z from 'zod';

export const env = createEnv({
  server: {
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
    // Provisioned by the Vercel Upstash/KV integration (managed secrets). The
    // read-only token and the rediss:// KV_URL/REDIS_URL are unused — the REST
    // client needs the write token.
    KV_REST_API_URL: z.string().optional(),
    KV_REST_API_TOKEN: z.string().optional(),
    BLOB_READ_WRITE_TOKEN: z.string().optional(),
  },
  client: {
    NEXT_PUBLIC_BETTER_AUTH_URL: z.string().url().optional(),
    NEXT_PUBLIC_APP_URL: z.string().url().optional(),
  },
  shared: {
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  },
  experimental__runtimeEnv: {
    NODE_ENV: process.env.NODE_ENV,
    NEXT_PUBLIC_BETTER_AUTH_URL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  },
  emptyStringAsUndefined: true,
  skipValidation: process.env.SKIP_ENV_VALIDATION === 'true',
});

export function deriveTrustedOrigins(raw: string | undefined, appUrl: string): string[] {
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [appUrl];
}

/**
 * NOTHING IN THIS MODULE MAY READ A `server:` VARIABLE AT MODULE SCOPE.
 *
 * `env` is a proxy: on the client its `get` trap throws
 * "❌ Attempted to access a server-side environment variable on the client" — and at module
 * scope that throw happens during *module evaluation*, so it takes down every client
 * component that imports `@/env` for a `NEXT_PUBLIC_*` value, whether or not that component
 * touches the server key.
 *
 * This is not hypothetical: `export const trustedOrigins = deriveTrustedOrigins(
 * env.TRUSTED_ORIGINS, env.APP_URL)` lived here and broke `/forgot-password` outright —
 * `forgot-password-form.tsx` imports `@/env` for `NEXT_PUBLIC_APP_URL`, so the page rendered
 * the auth error boundary, and its "try again" could never help because the module error is
 * cached by the bundler. It is derived in `src/auth.ts` now, at its only consumer.
 * `env.client.test.ts` guards this.
 *
 * Reading a server variable inside a server-only function body is fine — it is the
 * *module-scope* read that is fatal.
 */
