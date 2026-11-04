import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_RUN_ID, prepare, settle, snap } from "./fixtures";

/**
 * Phone width (390x844), light theme (S10, S12j): with no file the
 * Workbench is the import (drop zone and picker) on the whole screen, with
 * no tabs; once a file is loaded it is two tabs, "Inputs" and "Result",
 * under one command row. The navigation is a bottom bar. The run report is a
 * single column.
 */

const tab = (page: Page, name: "Inputs" | "Result") =>
  page.getByRole("tablist", { name: "Workbench view" }).getByRole("tab", { name });

/** The bottom bar: the primary navigation pinned to the viewport's bottom edge. */
async function expectBottomBar(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Primary navigation" });
  await expect(nav).toBeVisible();
  const box = await nav.boundingBox();
  const viewport = page.viewportSize();
  expect(box && viewport && box.y + box.height).toBeGreaterThan((viewport?.height ?? 0) - 60);
}

/**
 * The phone flow: with no file the picker fills the screen and there are no
 * tabs; picking the rocket shows the tabs on Inputs, where the site is
 * typed; pressing Run selects the Result tab.
 */
async function runIcarusOnPhone(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByRole("tablist", { name: "Workbench view" })).toHaveCount(0);
  await page.getByRole("button", { name: "Use Icarus Mk II" }).click();
  await expect(page.getByRole("button", { name: "Use Icarus Mk II" })).toHaveCount(0);
  await expect(tab(page, "Inputs")).toHaveAttribute("aria-selected", "true");
  await page.locator("#lat").fill("38.2655");
  await page.locator("#lon").fill("-0.6981");
  await page.locator("#elev").fill("42");
  await page.getByRole("button", { name: /Run simulation/ }).click();
  await expect(page.getByRole("region", { name: "Key results" })).toBeVisible();
  await expect(tab(page, "Result")).toHaveAttribute("aria-selected", "true");
}

/**
 * A full-page shot paints `position: fixed` elements where they sit in the
 * viewport, so the bottom bar would land mid-page. Grow the viewport to the
 * page's height first: the shot then shows the bar at the bottom, as a
 * phone does once scrolled to the end.
 */
async function snapPhone(page: Page, name: string): Promise<void> {
  await settle(page);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: 390, height });
  await snap(page, name);
}

test.beforeEach(async ({ page }) => {
  await prepare(page, "light");
});

test("workbench import (mobile)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Use Icarus Mk II" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Choose .ork file" })).toBeVisible();
  await expect(page.getByRole("tablist", { name: "Workbench view" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Inputs" })).toBeHidden();
  await snapPhone(page, "workbench-import-mobile-light");
});

test("workbench result (mobile)", async ({ page }) => {
  await runIcarusOnPhone(page);
  await expectBottomBar(page);
  await expect(page.getByRole("link", { name: "Workbench" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("complementary", { name: "Inputs" })).toBeHidden();
  await snapPhone(page, "workbench-result-mobile-light");
});

test("workbench inputs (mobile)", async ({ page }) => {
  await runIcarusOnPhone(page);
  await tab(page, "Inputs").click();
  await expect(page.getByRole("region", { name: "Results" })).toBeHidden();
  // The typed site survived the switch: the column is hidden, never unmounted.
  await expect(page.locator("#lat")).toHaveValue("38.2655");
  await snapPhone(page, "workbench-inputs-mobile-light");
});

test("report (mobile)", async ({ page }) => {
  await page.goto(`/results/${FIXTURE_RUN_ID}`);
  await expect(page.getByRole("region", { name: "Key results" })).toBeVisible();
  await expectBottomBar(page);
  // Nothing scrolls sideways at phone width.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await snapPhone(page, "report-mobile-light");
});
