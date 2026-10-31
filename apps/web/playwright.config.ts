import { defineConfig, devices } from "@playwright/test";

/**
 * Visual-regression suite (e2e/). Snapshots are only ever generated inside
 * the Playwright Docker image (see e2e/run-in-docker.sh), so the snapshot
 * path carries no platform suffix: a native run on macOS renders different
 * pixels and is for debugging only (`npm run e2e:visual:native`).
 *
 * Two web servers boot before the tests:
 * 1. e2e/stub-api.mjs — a deterministic stub of the icaro API on :4010.
 * 2. The production web build on :4011. ICARO_API_ORIGIN must be set at
 *    BUILD time (next.config.ts bakes the /api/* rewrite into the routes
 *    manifest), and lib/server-api.ts reads it at runtime for server fetches,
 *    so both point at the stub.
 */

const STUB_PORT = 4010;
const WEB_PORT = 4011;
const STUB_ORIGIN = `http://127.0.0.1:${STUB_PORT}`;

const buildEnv = {
  ICARO_API_ORIGIN: STUB_ORIGIN,
  // Firebase is only initialised on sign-in; the stub signs the user in
  // through GET /api/auth/me, so dummies are enough.
  NEXT_PUBLIC_FIREBASE_API_KEY: "e2e-dummy-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "e2e.invalid",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "icaro-e2e",
  NEXT_TELEMETRY_DISABLED: "1",
};

export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.002,
    },
  },
  use: {
    baseURL: `http://127.0.0.1:${WEB_PORT}`,
    locale: "en-GB",
    timezoneId: "Europe/Madrid",
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "desktop",
      testIgnore: /mobile\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
    },
    {
      name: "mobile",
      testMatch: /mobile\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        isMobile: false,
        hasTouch: true,
      },
    },
  ],
  webServer: [
    {
      command: `node e2e/stub-api.mjs`,
      url: `${STUB_ORIGIN}/healthz`,
      env: { STUB_API_PORT: String(STUB_PORT) },
      reuseExistingServer: !process.env.CI,
      stdout: "ignore",
      stderr: "pipe",
    },
    {
      command: `npm run build && npx next start -H 127.0.0.1 -p ${WEB_PORT}`,
      url: `http://127.0.0.1:${WEB_PORT}`,
      env: buildEnv,
      reuseExistingServer: !process.env.CI,
      // A cold `next build` inside the Docker image takes a few minutes.
      timeout: 10 * 60_000,
      stdout: "pipe",
      stderr: "pipe",
    },
  ],
});
