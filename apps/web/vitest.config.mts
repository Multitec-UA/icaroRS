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
    exclude: ["node_modules/**", ".next/**"],
  },
});
