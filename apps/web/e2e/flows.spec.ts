import { expect, test, type Page } from "@playwright/test";
import { FIXTURE_RUN_ID, ORK_FIXTURE, prepare, runIcarus } from "./fixtures";

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

test("an edit after a run survives a reload: Changed since run, with the Site chip", async ({ page }) => {
  await runIcarus(page);
  await expect(page).toHaveURL(/\/\?run=/);
  await page.locator("#elev").fill("120");
  await expect(page.getByRole("status").filter({ hasText: /^Changed since run / })).toBeVisible();

  await page.reload();

  await expect(page.getByRole("status").filter({ hasText: /^Changed since run / })).toBeVisible();
  await expect(page.getByRole("list", { name: "What changed" }).getByText("Site", { exact: true })).toBeVisible();
  await expect(page.locator("#elev")).toHaveValue("120");
});

test("a second rocket after a run starts clean, like the first one", async ({ page }) => {
  await runIcarus(page);
  await expect(page.getByRole("status").filter({ hasText: /^Up to date · run / })).toBeVisible();

  // The rocket panel's drop zone, sent to another of the org's rockets.
  await page.getByRole("button", { name: /Icarus Mk II · / }).click();
  await page.locator('input[type="file"][name="rocket-panel-new-file"]').setInputFiles(ORK_FIXTURE);
  await expect(page.getByText("Where does this file go?")).toBeVisible();
  await page.getByRole("radio", { name: /Add to one of my rockets/ }).check();
  await page.getByRole("combobox", { name: "Rocket to add this file to" }).selectOption({ label: "Dédalo" });
  await page.getByRole("button", { name: "Convert" }).click();

  await expect(page.getByRole("button", { name: /^Dédalo · / })).toBeVisible();
  // The previous rocket's run leaves the screen: the status reads as before a first run, no results.
  await expect(page.getByRole("status").filter({ hasText: /^No run yet$/ })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: /run-/ })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Key results" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Run simulation/ })).toBeVisible();
  await expect(page).toHaveURL(/\/\?file=/);
  // The launch context stays.
  await expect(page.locator("#lat")).toHaveValue("38.2655");
});

test("Download PDF prints a complete technical report: every section expanded, every figure loaded", async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: { sections: number; figures: number; loaded: number }[] };
    w.__prints = [];
    window.print = () => {
      const doc = document.querySelector("[data-print-report]");
      const imgs = Array.from(doc?.querySelectorAll("img") ?? []) as HTMLImageElement[];
      w.__prints.push({
        sections: doc?.querySelectorAll("h2").length ?? 0,
        figures: imgs.length,
        loaded: imgs.filter((img) => img.complete && img.naturalWidth > 0).length,
      });
    };
  });
  await page.goto(`/results/${FIXTURE_RUN_ID}`);
  await expect(page.getByRole("region", { name: "Key results" })).toBeVisible();
  // The screen keeps its disclosures closed; the PDF never depends on them.
  await page.getByRole("button", { name: "Download PDF" }).click();

  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __prints: unknown[] }).__prints.length))
    .toBe(1);
  const [printed] = await page.evaluate(
    () => (window as unknown as { __prints: { sections: number; figures: number; loaded: number }[] }).__prints,
  );
  expect(printed.sections).toBe(6);
  expect(printed.figures).toBe(12);
  expect(printed.loaded).toBe(12);

  // In print media only the document shows, never the screen report.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("[data-print-report]")).toBeVisible();
  await expect(page.getByRole("region", { name: "Key results" })).toBeHidden();
});

test("a stored run opened from its URL loads every plot (stored names already carry .png)", async ({ page }) => {
  await page.goto(`/?run=${FIXTURE_RUN_ID}`);
  await expect(upToDate(page, FIXTURE_RUN_ID)).toBeVisible();
  const broken: string[] = [];
  page.on("response", (res) => {
    if (res.url().includes("/plots/") && res.status() !== 200) broken.push(`${res.status()} ${res.url()}`);
  });

  await page.locator("summary", { hasText: "Plots (12)" }).click();

  const plots = page.locator('img[src*="/plots/"]');
  await expect(plots).toHaveCount(12);
  await expect
    .poll(() => plots.evaluateAll((imgs) => imgs.filter((img) => (img as HTMLImageElement).naturalWidth > 0).length))
    .toBe(12);
  expect(broken).toEqual([]);
});

/**
 * Production-sized data (one rocket with 18 files and 35 runs, 2026-11-04):
 * the import entry points and the compare area must stay in view, never be
 * buried under a long list.
 */
async function withProductionSizedData(page: Page) {
  await page.route("**/api/rockets/*", async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const res = await route.fetch();
    const rocket = await res.json();
    const [first] = rocket.exports;
    const exports = Array.from({ length: 18 }, (_, i) => ({
      ...first,
      export_id: i === 0 ? first.export_id : `${first.export_id}-copy-${i}`,
      ork_filename: `MT1-v1.${i % 6}.0.ork`,
      created_at: new Date(Date.UTC(2026, 5, 30 - i)).toISOString(),
    }));
    await route.fulfill({ response: res, json: { ...rocket, exports } });
  });
  await page.route("**/api/history?*", async (route) => {
    const res = await route.fetch();
    const runs = await res.json();
    if (!Array.isArray(runs) || runs.length === 0) return route.fulfill({ response: res });
    const many = Array.from({ length: 35 }, (_, i) => ({
      ...runs[i % runs.length],
      simulation_id: i < runs.length ? runs[i].simulation_id : `${runs[i % runs.length].simulation_id}-copy-${i}`,
      created_at: new Date(Date.UTC(2026, 9, 30, 12, 0) - i * 3_600_000).toISOString(),
    }));
    await route.fulfill({ response: res, json: many });
  });
}

test("with many files, the rocket panel keeps 'add a file' and 'new rocket' in view", async ({ page }) => {
  await withProductionSizedData(page);
  await page.goto(`/?file=${ICARUS_V3}`);
  await page.getByRole("button", { name: /Icarus Mk II · / }).click();
  const dialog = page.getByRole("dialog", { name: "Rocket Icarus Mk II" });
  await expect(dialog.getByRole("radio")).toHaveCount(18);

  await expect(dialog.getByText("Drop a .ork to add it to Icarus Mk II")).toBeInViewport();
  await expect(dialog.getByText("+ New rocket from .ork")).toBeInViewport();
});

test("with many runs, the compare chart and what changed stay in view on /runs", async ({ page }) => {
  await withProductionSizedData(page);
  await page.goto("/runs");
  await expect(page.getByRole("table").getByRole("row")).toHaveCount(36);

  await expect(page.getByRole("heading", { name: "Altitude", exact: true })).toBeInViewport();
  await expect(page.getByRole("heading", { name: "What changed" })).toBeInViewport();
});
