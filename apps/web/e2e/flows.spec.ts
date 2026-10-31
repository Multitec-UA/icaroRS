import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_RUN_ID, prepare, runIcarus } from "./fixtures";

/**
 * Behaviour flows against the stub API (S1/S8/S9): the Workbench's state in
 * its URL, lossless moves between /runs, the report and the Workbench, and
 * import reachability. No screenshots here; visual.spec.ts owns the pixels.
 */

const ICARUS_V3 = "exp-icarus-v3";

function upToDate(page: Page, runId: string) {
  return page.getByRole("status").filter({ hasText: `Up to date · run ${runId}` });
}

test.beforeEach(async ({ page }) => {
  await prepare(page, "light");
});

test("a run URL opens the run up to date; an edit marks it changed", async ({ page }) => {
  await page.goto(`/?run=${FIXTURE_RUN_ID}`);

  await expect(upToDate(page, FIXTURE_RUN_ID)).toBeVisible();
  await expect(page.getByRole("button", { name: /Icarus Mk II · icarus-mk2-v3\.ork/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Key results" })).toBeVisible();
  await expect(page.locator("#lat")).toHaveValue("38.2655");

  await page.locator("#elev").fill("120");
  await expect(page.getByRole("status").filter({ hasText: /^Changed since run / })).toBeVisible();
  await expect(page.getByRole("list", { name: "What changed" }).getByText("Site", { exact: true })).toBeVisible();
  // Edits never touch the URL.
  await expect(page).toHaveURL(new RegExp(`/\\?run=${FIXTURE_RUN_ID}$`));
});

test("Open in Workbench from /runs shows the same run, and back returns to /runs", async ({ page }) => {
  await page.goto("/runs");
  // The row shows a short run id; the link carries the full one.
  const open = page.getByRole("link", { name: "Open in Workbench" }).and(page.locator(`[href="/?run=${FIXTURE_RUN_ID}"]`));
  await open.click();

  await expect(page).toHaveURL(new RegExp(`/\\?run=${FIXTURE_RUN_ID}$`));
  await expect(upToDate(page, FIXTURE_RUN_ID)).toBeVisible();
  await expect(page.getByRole("region", { name: "Key results" })).toBeVisible();

  await page.goBack();
  await expect(page).toHaveURL(/\/runs$/);
});

test("a run URL that no longer exists explains itself and Start fresh clears the URL", async ({ page }) => {
  await page.goto("/?run=does-not-exist");

  await expect(page.getByText("This run's file is no longer available")).toBeVisible();
  await page.getByRole("button", { name: "Start fresh" }).click();

  await expect(page).toHaveURL(/127\.0\.0\.1:\d+\/$/);
  await expect(page.getByText("Drop your OpenRocket file here")).toBeVisible();
});

test("a .ork dropped anywhere on the Workbench opens the destination card", async ({ page }) => {
  await page.goto(`/?file=${ICARUS_V3}`);
  await expect(page.getByRole("button", { name: /Icarus Mk II · / })).toBeVisible();

  const dataTransfer = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["<openrocket/>"], "icarus-mk2-v4.ork", { type: "application/octet-stream" }));
    return transfer;
  });
  const target = page.getByRole("region", { name: "Results" });
  await target.dispatchEvent("dragenter", { dataTransfer });
  await expect(page.getByText("Drop your .ork to import it")).toBeVisible();
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });

  await expect(page.getByText("Drop your .ork to import it")).toHaveCount(0);
  await expect(page.getByText("Where does this file go?")).toBeVisible();
});

test("the rocket button opens the panel with the active file", async ({ page }) => {
  // The API's ExportSummary.rocket_id is required and non-null, so the stub
  // cannot serve a rocket-less (legacy) file; that case is unit-tested
  // (WorkbenchImport.test.tsx). Here: the panel opens from a file URL.
  await page.goto(`/?file=${ICARUS_V3}`);
  await page.getByRole("button", { name: /Icarus Mk II · / }).click();

  const dialog = page.getByRole("dialog", { name: "Rocket Icarus Mk II" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("radio", { name: /icarus-mk2-v3\.ork/ })).toBeChecked();
});

test("leaving the Workbench and coming back keeps the draft and the run", async ({ page }) => {
  await runIcarus(page);
  await expect(page).toHaveURL(/\/\?run=/);
  await page.locator("#elev").fill("120");
  await expect(page.getByRole("status").filter({ hasText: /^Changed since run / })).toBeVisible();

  await page.getByRole("link", { name: "Runs" }).click();
  await expect(page).toHaveURL(/\/runs$/);
  await page.goBack();

  await expect(page.getByRole("status").filter({ hasText: /^Changed since run / })).toBeVisible();
  await expect(page.locator("#elev")).toHaveValue("120");
});
