import type { NextConfig } from "next";

// The icaro API (apps/api) runs as a separate origin (FastAPI on :8000).
// Instead of enabling CORS on the API — which would add server-side plumbing
// and complicate HTTP Basic credentials across origins — we proxy /api/* from
// the Next dev/runtime server to the API. To the browser everything is
// same-origin (:3000), so no CORS and the frozen /api contract is untouched.
//
// ICARO_API_ORIGIN is a BUILD-TIME variable, not a runtime one. Reading it
// inside rewrites() does NOT make it runtime-configurable: `rewrites()` itself
// is evaluated during `next build`, and the RESOLVED destination is written
// into .next/routes-manifest.json. `output: "standalone"` emits no
// next.config.js at all, so the standalone server has nothing to re-evaluate
// at boot — it just serves the baked manifest.
//
// Verified empirically on Next 16.2.6: built with ICARO_API_ORIGIN=
// http://build-time-canary:1111, then started .next/standalone/server.js with
// ICARO_API_ORIGIN=http://run-time-canary:2222. The server tried to reach
// build-time-canary (ENOTFOUND); the runtime value was ignored.
//
// Consequence: to change the proxy target you must REBUILD the image with
//   docker build --build-arg ICARO_API_ORIGIN=https://your-api ...
// Setting ICARO_API_ORIGIN on the Cloud Run service is a no-op. See DEPLOY.md.

const nextConfig: NextConfig = {
  // Emit a self-contained server (.next/standalone/server.js + the minimal
  // traced node_modules) so the Docker runtime image carries only what it needs
  // — see apps/web/Dockerfile. Has no effect on `next dev`.
  output: "standalone",

  async rewrites() {
    const API_ORIGIN = process.env.ICARO_API_ORIGIN ?? "http://127.0.0.1:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${API_ORIGIN}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
