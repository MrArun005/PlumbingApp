import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  plugins: [
    // NestJS DI needs decorator metadata, which esbuild cannot emit — swc can.
    swc.vite({ module: { type: 'es6' } }),
  ],
});
