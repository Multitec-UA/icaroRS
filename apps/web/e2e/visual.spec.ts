import { expect, test } from "@playwright/test";
import { FIXTURE_RUN_ID, ORK_FIXTURE, THEMES, masks, prepare, runIcarus, snap, loadIcarus } from "./fixtures";

/**
 * Baseline screenshots of every screen of the product, in both themes, at
 * 1440x900 against the stub API (e2e/stub-api.mjs). See apps/web/README.md
 * ("Visual regression") for how to run and update them.
 */

for (const theme of THEMES) {
  test.describe(`${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await prepare(page, theme);
    });

    test("workbench empty", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Use Icarus Mk II" })).toBeVisible();
      await snap(page, `workbench-empty-${theme}`);
    });

    test("workbench destination and converting", async ({ page }) => {
      // Hold the convert response inside the browser until the converting
      // state has been captured, so its timing never depends on the stub.
      let release: () => void = () => {};
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/api/convert", async (route) => {
        await held;
        await route.continue();
      });

      await page.goto("/");
      await expect(page.getByRole("button", { name: "Use Icarus Mk II" })).toBeVisible();
      await page.locator('input[type="file"][name="rocket-file"]').setInputFiles(ORK_FIXTURE);
      await expect(page.getByRole("button", { name: "Convert" })).toBeVisible();
      await snap(page, `workbench-destination-${theme}`);

      await page.getByRole("button", { name: "Convert" }).click();
      await expect(page.getByRole("progressbar")).toBeVisible();
      // Network idle cannot be awaited while the request is held on purpose.
      await page.evaluate(() => document.fonts.ready);
      await expect(page).toHaveScreenshot(`workbench-converting-${theme}.png`, {
        fullPage: true,
        mask: masks(page),
      });
      release();
      await expect(page.getByRole("progressbar")).toHaveCount(0);
    });

    test("workbench ready", async ({ page }) => {
      await loadIcarus(page);
      await snap(page, `workbench-ready-${theme}`);
    });

    test("workbench result", async ({ page }) => {
      await runIcarus(page);
      await snap(page, `workbench-result-${theme}`);
    });

    test("rocket panel", async ({ page }) => {
      await loadIcarus(page);
      await page.getByRole("button", { name: /Active rocket and file|Icarus Mk II/ }).first().click();
      await expect(page.getByRole("dialog", { name: "Rocket Icarus Mk II" })).toBeVisible();
      await snap(page, `rocket-panel-${theme}`, { fullPage: false });
    });

    test("rockets", async ({ page }) => {
      await page.goto("/rockets");
      await expect(page.getByText("Dédalo").first()).toBeVisible();
      await snap(page, `rockets-${theme}`);
    });

    test("runs with compare overlay", async ({ page }) => {
      await page.goto("/runs");
      const compare = page.getByRole("checkbox", { name: /^Compare run/ });
      await expect(compare.first()).toBeVisible();
      await compare.nth(1).check();
      await expect(compare.nth(1)).toBeChecked();
      await snap(page, `runs-${theme}`);
    });

    test("report", async ({ page }) => {
      await page.goto(`/results/${FIXTURE_RUN_ID}`);
      await expect(page.getByRole("region", { name: "Key results" })).toBeVisible();
      await snap(page, `report-${theme}`);
    });

    test("login", async ({ page }) => {
      await prepare(page, theme, { anonymous: true });
      await page.goto("/");
      await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
      await snap(page, `login-${theme}`);
    });
  });
}
