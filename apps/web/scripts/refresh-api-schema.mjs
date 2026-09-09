#!/usr/bin/env node
/**
 * OpenAPI schema snapshot refresher — issue #51.
 *
 * Regenerates openapi/schema.json from the FastAPI app in apps/api by
 * shelling out to `uv run` (no server is started — see
 * apps/api/icaro_api/scripts/export_openapi.py).
 *
 * Decision (documented per issue #51): the schema is a COMMITTED SNAPSHOT,
 * not fetched from a locally-running API at generation/CI time. Trade-off:
 * - CI determinism — `npm run api:check` (and `npm ci && npm run build`)
 *   never depend on a live API process, a free port, or apps/api's Python
 *   toolchain being installed in the web job at all.
 * - The cost is an explicit, manual step: whoever changes an apps/api
 *   response/request shape must remember to run `npm run api:schema` (this
 *   script) and commit the refreshed snapshot + regenerated types
 *   (`npm run api:types`). Forgetting doesn't corrupt anything silently —
 *   `npm run api:check` (wired into CI, see .github/workflows/test-icaro.yaml)
 *   fails as soon as someone else does remember and the two drift apart.
 *
 * Requires a synced uv workspace (`uv sync` from the repo root, or
 * `uv sync --all-packages --all-groups`) — this script does not sync it
 * for you, matching every other uv invocation documented in AGENTS.md.
 *
 * Run: npm run api:schema
 * Then: npm run api:types   (regenerate lib/api/schema.d.ts)
 * Commit both openapi/schema.json and lib/api/schema.d.ts together.
 */

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const apiRoot = join(webRoot, "..", "api");
const schemaOutPath = join(webRoot, "openapi", "schema.json");

const result = spawnSync(
  "uv",
  ["run", "--no-sync", "python", "-m", "icaro_api.scripts.export_openapi", schemaOutPath],
  { cwd: apiRoot, stdio: "inherit" },
);

if (result.error) {
  console.error(`[api:schema] Failed to run uv: ${result.error.message}`);
  console.error("[api:schema] Is uv installed and is the workspace synced (`uv sync`)?");
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log(`[api:schema] Refreshed openapi/schema.json from apps/api.`);
console.log(`[api:schema] Next: run \`npm run api:types\` and commit both files.`);
