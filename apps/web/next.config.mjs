const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Type and lint errors are caught by `pnpm typecheck` / `pnpm lint` in CI,
  // but we also want `next build` itself to fail on them — that's the default,
  // spelled out here so nobody "fixes" a red build by flipping these on.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: true },
  // The floating dev badge sits on top of the UI and shows up in review
  // screenshots. Dev-only cosmetics; nothing about the build changes.
  devIndicators: false,

  /**
   * Same-origin proxy for the browser-side API calls.
   *
   * apps/api does not call `app.enableCors()`, so a direct fetch from
   * http://localhost:3001 to http://localhost:3000 is blocked by the browser.
   * Rather than change the backend (owned by another work order), the browser
   * talks to this app at /api/pipefix/* and Next forwards to the real API
   * server-side. Method, body, and headers — including Authorization and
   * Idempotency-Key — are passed straight through.
   *
   * Server-rendered catalogue reads bypass this and call the API directly;
   * there is no CORS on the server.
   */
  async rewrites() {
    return [{ source: '/api/pipefix/:path*', destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
