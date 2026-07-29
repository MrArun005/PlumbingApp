import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    // DB integration tests talk to the docker-compose Postgres; they skip
    // themselves cleanly when it is not reachable.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
