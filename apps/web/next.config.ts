import type { NextConfig } from "next";

// The icaro API (apps/api) runs as a separate origin (FastAPI on :8000).
// Instead of enabling CORS on the API — which would add server-side plumbing
// and complicate HTTP Basic credentials across origins — we proxy /api/* from
// the Next dev/runtime server to the API. To the browser everything is
// same-origin (:3000), so no CORS and the frozen /api contract is untouched.
//
// Override the target in other environments with ICARO_API_ORIGIN. The value
// must be read INSIDE rewrites() — Next's standalone build (output: "standalone")
// snapshots top-level config evaluation, so a module-scope `process.env` read
// would freeze the default into the runtime image.

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
