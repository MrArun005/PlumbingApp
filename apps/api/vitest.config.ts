import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // These are integration tests against ONE shared Postgres + Redis. Running
    // files in parallel makes them fight over seeded rows and Redis keys (an
    // OTP-key cleanup in one file wipes another file's in-flight code). Shared
    // mutable state means sequential, or the failures are meaningless.
    fileParallelism: false,
  },
  plugins: [
    // NestJS DI needs decorator metadata, which esbuild cannot emit — swc can.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
