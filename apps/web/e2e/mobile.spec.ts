import { test } from "@playwright/test";
import { prepare, runIcarus, snap } from "./fixtures";

/** The Workbench with a result at phone width (390x844), light theme. */
test("workbench result (mobile)", async ({ page }) => {
  await prepare(page, "light");
  await runIcarus(page);
  await snap(page, "workbench-result-mobile-light");
});
