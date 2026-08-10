// @vitest-environment jsdom
//
// `@t3-oss/env-core` decides which half of the schema it is serving with
// `typeof window === 'undefined'` (verified in the installed
// `@t3-oss/env-core/dist/index.js:19`), so a jsdom environment IS the client as far as the
// proxy is concerned. That makes this file a faithful stand-in for the browser bundle
// without one.
//
// What it guards: `src/env.ts` must stay importable from a client component. A module-scope
// read of a `server:` key throws during *module evaluation*, which takes down every client
// component importing `@/env` — even one that only wants a `NEXT_PUBLIC_*` value. That
// shipped: `export const trustedOrigins = deriveTrustedOrigins(env.TRUSTED_ORIGINS,
// env.APP_URL)` at the bottom of this module made `/forgot-password` render the auth error
// boundary, with a "try again" that could never work because the bundler caches the module
// error.
import { describe, expect, it } from 'vitest';

import { env } from '@/env';

describe('@/env in a client environment', () => {
  it('imports without throwing and serves a NEXT_PUBLIC_ value', () => {
    // The import above is the assertion — if any module-scope line read a server key this
    // file would never have been collected. Touching a client key proves the proxy is live
    // and in client mode, so the test cannot pass by importing a dead module.
    expect(() => env.NEXT_PUBLIC_APP_URL).not.toThrow();
  });

  it('still refuses a server variable, so the check above is discriminating', () => {
    // Without this, "no throw on import" would also pass if the proxy were somehow in
    // server mode and every access were permitted.
    expect(() => (env as unknown as Record<string, unknown>).DATABASE_URL).toThrow(
      /server-side environment variable on the client/,
    );
  });
});
