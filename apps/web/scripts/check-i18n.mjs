#!/usr/bin/env node
/**
 * Catalog completeness gate — dependency-free Node ESM.
 *
 * Asserts:
 *   (a) en.json and es.json have identical key sets (symmetric diff)
 *   (b) no key has an empty-string value in either catalog
 *
 * Exits 0 on success, non-zero on any violation.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

if (failed) {
  process.exit(1);
}

const total = enKeys.size;
console.log(`[i18n:check] OK — ${total} keys, both catalogs in sync.`);
