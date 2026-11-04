import { expect, type Locator, type Page } from "@playwright/test";
import path from "node:path";

/**
 * Shared helpers for the visual suite. Every screenshot goes through
 * `snap()`, so the same stabilisation (theme, frozen clock, stub tiles,
 * fonts, network idle, masks) applies everywhere.
 */

export type Theme = "light" | "dark";
export const THEMES: Theme[] = ["light", "dark"];

const STUB_ORIGIN = "http://127.0.0.1:4010";
// Playwright loads specs as CommonJS, so __dirname is available.
const HERE = __dirname;

/** A tiny file named like a real export; the stub never parses it. */
export const ORK_FIXTURE = path.join(HERE, "assets", "icarus-mk2-v3.ork");

/** The newest Icarus run in e2e/stub-api.mjs (the one /api/simulate answers with). */
export const FIXTURE_RUN_ID = "run-icarus-0004";

/** A fixed instant inside the fixtures' 2026 timeline. */
const NOW = new Date("2026-10-31T10:00:00Z");

/**
 * Prepare a page before its first navigation: theme cookie (read by
 * app/layout.tsx on the server and ThemeProvider on the client), optional
 * anonymous switch for the stub, a frozen clock and stubbed map tiles.
 */
export async function prepare(page: Page, theme: Theme, options: { anonymous?: boolean } = {}): Promise<void> {
  await page.context().addCookies(
    [
      { name: "icaro-theme", value: theme },
      ...(options.anonymous ? [{ name: "e2e-anon", value: "1" }] : []),
      // Pin the locale too: the layout resolves it from NEXT_LOCALE first.
      { name: "NEXT_LOCALE", value: "en" },
    ].map((c) => ({ ...c, domain: "127.0.0.1", path: "/" })),
  );
  await page.clock.setFixedTime(NOW);
  const tile = await stubTile();
  await page.route(/\.tile\.openstreetmap\.org\//, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: tile }),
  );
}

let tileCache: Buffer | null = null;

/** The flat map tile served by the stub API, fetched once per worker. */
async function stubTile(): Promise<Buffer> {
  if (!tileCache) {
    const res = await fetch(`${STUB_ORIGIN}/tile.png`);
    tileCache = Buffer.from(await res.arrayBuffer());
  }
  return tileCache;
}

/**
 * Masks for pixels that are not deterministic between runs: the WebGL
 * flight replay (react-three-fiber). ECharts canvases (marked by ZRender's
 * `data-zr-dom-id`) render deterministically with animations off, so they
 * stay in the snapshot.
 */
export function masks(page: Page): Locator[] {
  return [page.locator("canvas:not([data-zr-dom-id])")];
}

/** Wait until the page is quiet: network idle, web fonts loaded, images decoded. */
export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images).map((img) => (img.complete ? null : img.decode().catch(() => null))),
    );
  });
}

/** Stabilise, then compare against the committed snapshot `<name>.png`. */
export async function snap(page: Page, name: string, options: { fullPage?: boolean } = {}): Promise<void> {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: options.fullPage ?? true,
    mask: masks(page),
  });
}

/** Load the "Icarus Mk II" rocket from the Workbench picker (file loaded, no run). */
export async function loadIcarus(page: Page): Promise<void> {
  await page.goto("/");
  await page.getByRole("button", { name: "Use Icarus Mk II" }).click();
  await expect(page.getByRole("button", { name: "Use Icarus Mk II" })).toHaveCount(0);
}

/** Fill the launch site so the scenario can run, then Run and wait for the KPI cards. */
export async function runIcarus(page: Page): Promise<void> {
  await loadIcarus(page);
  await page.locator("#lat").fill("38.2655");
  await page.locator("#lon").fill("-0.6981");
  await page.locator("#elev").fill("42");
  await page.getByRole("button", { name: /Run simulation/ }).click();
  await expect(page.getByRole("region", { name: "Key results" })).toBeVisible();
}
