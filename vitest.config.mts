import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    environment: 'node',
    // `app/**/*.test.ts` as well as `.tsx`: a non-component test under `app/` (a server
    // action, a route handler) was silently never collected — vitest reports "No test
    // files found" for it and nothing else, so the file looks written and proves nothing.
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'app/**/*.test.ts', 'app/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    env: {
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/oarly_test',
      BETTER_AUTH_SECRET: 'test-secret',
      BETTER_AUTH_URL: 'http://localhost:3000',
      APP_URL: 'http://localhost:3000',
    },
  },
});
