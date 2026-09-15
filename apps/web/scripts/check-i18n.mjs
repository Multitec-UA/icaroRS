#!/usr/bin/env node
/**
 * i18n completeness gate.
 *
 * Asserts:
 *   (a) en.json and es.json have identical key sets (symmetric diff)
 *   (b) no key has an empty-string value in either catalog
 *   (c) no untranslated JSX literal, and no hardcoded Next.js `metadata`
 *       copy, under components/ or app/ (issues #54 and #103 — (a) and (b)
 *       only ever caught catalog PARITY; a literal that never called t() at
 *       all was invisible to them, which is exactly how eight hardcoded
 *       strings shipped past this gate. See i18n-literal-scan.mjs.
 *
 * Exits 0 on success, non-zero on any violation.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanForUntranslatedLiterals } from "./i18n-literal-scan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const messagesDir = join(__dirname, "..", "messages");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loadJson(filename) {
  const path = join(messagesDir, filename);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`[i18n:check] Failed to read ${filename}: ${e.message}`);
    process.exit(1);
  }
}

/**
 * Recursively flatten a nested object to dot-path → value pairs.
 * e.g. { auth: { signIn: "Sign in" } } → { "auth.signIn": "Sign in" }
 */
function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      flatten(value, path, out);
    } else {
      out[path] = value;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Load + flatten both catalogs
// ---------------------------------------------------------------------------

const en = flatten(loadJson("en.json"));
const es = flatten(loadJson("es.json"));

const enKeys = new Set(Object.keys(en));
const esKeys = new Set(Object.keys(es));

// ---------------------------------------------------------------------------
// Check (a) — symmetric key sets
// ---------------------------------------------------------------------------

const onlyInEn = [...enKeys].filter((k) => !esKeys.has(k));
const onlyInEs = [...esKeys].filter((k) => !enKeys.has(k));

// ---------------------------------------------------------------------------
// Check (b) — no empty-string values
// ---------------------------------------------------------------------------

const emptyInEn = Object.entries(en)
  .filter(([, v]) => v === "")
  .map(([k]) => k);
const emptyInEs = Object.entries(es)
  .filter(([, v]) => v === "")
  .map(([k]) => k);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

let failed = false;

if (onlyInEn.length > 0) {
  console.error(`[i18n:check] Keys present in en.json but MISSING from es.json (${onlyInEn.length}):`);
  for (const k of onlyInEn) console.error(`  - ${k}`);
  failed = true;
}

if (onlyInEs.length > 0) {
  console.error(`[i18n:check] Keys present in es.json but MISSING from en.json (${onlyInEs.length}):`);
  for (const k of onlyInEs) console.error(`  - ${k}`);
  failed = true;
}

if (emptyInEn.length > 0) {
  console.error(`[i18n:check] Empty-string values in en.json (${emptyInEn.length}):`);
  for (const k of emptyInEn) console.error(`  - ${k}`);
  failed = true;
}

if (emptyInEs.length > 0) {
  console.error(`[i18n:check] Empty-string values in es.json (${emptyInEs.length}):`);
  for (const k of emptyInEs) console.error(`  - ${k}`);
  failed = true;
}

// ---------------------------------------------------------------------------
// Check (c) — untranslated literals (JSX + route metadata) under
// components/ and app/
// ---------------------------------------------------------------------------

const { violations, unusedAllowlistEntries } = scanForUntranslatedLiterals();

if (violations.length > 0) {
  console.error(
    `[i18n:check] Untranslated literal${violations.length === 1 ? "" : "s"} found (${violations.length}) — route these through t() and add the key to both catalogs, or add a documented entry to scripts/i18n-literal-allowlist.mjs if this one is deliberate:`,
  );
  for (const v of violations) {
    console.error(`  - ${v.file}:${v.line} [${v.kind}] ${JSON.stringify(v.text)}`);
  }
  failed = true;
}

if (unusedAllowlistEntries.length > 0) {
  console.warn(
    `[i18n:check] Warning: ${unusedAllowlistEntries.length} entr${unusedAllowlistEntries.length === 1 ? "y" : "ies"} in scripts/i18n-literal-allowlist.mjs matched nothing this run (stale — the literal changed or moved). Not failing the build, but please clean these up:`,
  );
  for (const e of unusedAllowlistEntries) {
    console.warn(`  - ${e.file}: ${JSON.stringify(e.text)}`);
  }
}

if (failed) {
  process.exit(1);
}

const total = enKeys.size;
console.log(
  `[i18n:check] OK — ${total} keys in sync across both catalogs; no untranslated JSX literals or metadata copy under components/ or app/.`,
);
