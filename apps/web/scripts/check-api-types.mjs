#!/usr/bin/env node
/**
 * Generated API types drift gate — mirrors scripts/check-i18n.mjs.
 *
 * Regenerates lib/api/schema.d.ts from openapi/schema.json in memory (reusing
 * scripts/gen-api-types.mjs) and diffs it against the committed file. Exits
 * non-zero if they differ, so schema/type drift becomes a red CI build
 * instead of a runtime surprise — the same guarantee `npm run i18n:check`
 * gives for message catalogs.
 *
 * This does NOT catch apps/api response shapes drifting from reality when
 * a router returns an untyped dict (see lib/api.ts header comment) — only
 * FastAPI-declared shapes (Pydantic response/request models) round-trip
 * through the OpenAPI schema this check compares against.
 *
 * Run: npm run api:check
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { generate } from "./gen-api-types.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const outPath = join(webRoot, "lib", "api", "schema.d.ts");

async function main() {
  const fresh = await generate();

  let committed;
  try {
    committed = readFileSync(outPath, "utf8");
  } catch (e) {
    console.error(`[api:check] Failed to read ${outPath}: ${e.message}`);
    console.error("[api:check] Run `npm run api:types` to generate it.");
    process.exit(1);
  }

  if (fresh !== committed) {
    console.error(
      "[api:check] lib/api/schema.d.ts is out of date with openapi/schema.json.",
    );
    console.error("[api:check] Run `npm run api:types` and commit the result.");
    process.exit(1);
  }

  console.log("[api:check] OK — lib/api/schema.d.ts matches openapi/schema.json.");
}

main();
