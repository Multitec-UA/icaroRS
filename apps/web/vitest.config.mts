import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

// See node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md — this is
// the officially documented setup for Next.js App Router projects. Async
// Server Components are NOT supported by Vitest (per that guide), which is
// why the route-level smoke tests target the client components a page.tsx
// renders rather than the (often async) page.tsx itself.
export default defineConfig({
  plugins: [tsconfigPaths(), react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.tsx"],
    css: false,
    // scripts/__fixtures__ holds planted-literal fixtures for
    // i18n-literal-scan.test.mjs (issue #54) — including one intentionally
    // named *.test.tsx (Ignored.test.tsx, proving test files are excluded
    // from the real scan). Vitest's default glob would otherwise try to run
    // it as an actual test file and fail on "no test suite found".
    exclude: ["node_modules/**", ".next/**", "scripts/__fixtures__/**"],
  },
});
