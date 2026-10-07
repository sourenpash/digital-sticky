import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'web/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    // Run date logic in a US time zone, where UTC-parsing bugs show up as off-by-one days.
    env: { TZ: 'America/New_York' },
  },
});
