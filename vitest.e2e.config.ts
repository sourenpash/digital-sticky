import { defineConfig } from 'vitest/config';

// End-to-end tests: a real board server and headless Chromium playing the phone,
// a computer and the wall. Run with `npm run test:e2e` (it builds the app first).
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    fileParallelism: false,
    env: { TZ: 'America/New_York' },
  },
});
