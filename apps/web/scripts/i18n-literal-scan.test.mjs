import { describe, expect, it } from "vitest";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanForUntranslatedLiterals } from "./i18n-literal-scan.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(__dirname, "__fixtures__", "i18n-literal-scan");

/**
 * These tests run the REAL scanner against a small, isolated fixture tree
 * (scripts/__fixtures__/i18n-literal-scan/) rather than this repo's actual
 * components/app directories, so a planted literal reliably fails the check
 * regardless of what the real codebase currently contains — issue #54's
 * explicit ask: "cover the new leak detection so it actually fails on a
 * planted literal."
 */
describe("scanForUntranslatedLiterals (issue #54 — real leak detection, not just catalog parity)", () => {
  it("flags a plain JSX text leak, a bare attribute leak, and a leak reachable only through a ternary", () => {
    const { violations } = scanForUntranslatedLiterals({ root: fixtureRoot });

    const leaky = violations.filter((v) => v.file === "components/Leaky.tsx");
    expect(leaky.map((v) => v.text).sort()).toEqual(
      ["Planted placeholder leak", "Planted ternary leak", "Planted text leak"].sort(),
    );

    // The ternary's already-translated t() branch must NOT be reported.
    expect(leaky.some((v) => v.text.includes("leaky.a"))).toBe(false);
  });

  it("never flags anything in a *.test.tsx fixture", () => {
    const { violations } = scanForUntranslatedLiterals({ root: fixtureRoot });

    expect(violations.some((v) => v.file.includes("Ignored.test.tsx"))).toBe(false);
  });

  it("scans app/ as well as components/", () => {
    const { violations } = scanForUntranslatedLiterals({ root: fixtureRoot });

    expect(violations.some((v) => v.file === "app/Root.tsx" && v.text === "Planted app-dir leak")).toBe(
      true,
    );
  });

  it("never flags a clean file that routes everything through t()", () => {
    const { violations } = scanForUntranslatedLiterals({ root: fixtureRoot });

    expect(violations.some((v) => v.file === "components/Clean.tsx")).toBe(false);
  });

  it("exempts a literal matching a documented allowlist entry, and counts the entry as used", () => {
    const allowlist = [
      { file: "components/Allowed.tsx", text: "Deliberately allowed literal", reason: "fixture" },
    ];

    const { violations, unusedAllowlistEntries } = scanForUntranslatedLiterals({
      root: fixtureRoot,
      allowlist,
    });

    expect(violations.some((v) => v.file === "components/Allowed.tsx")).toBe(false);
    expect(unusedAllowlistEntries).toEqual([]);
  });

  it("reports a stale allowlist entry whose text no longer appears anywhere in its file", () => {
    const allowlist = [
      { file: "components/Allowed.tsx", text: "This text was never planted anywhere", reason: "fixture" },
    ];

    const { unusedAllowlistEntries } = scanForUntranslatedLiterals({ root: fixtureRoot, allowlist });

    expect(unusedAllowlistEntries).toEqual(allowlist);
  });

  it("does not report an allowlist entry as stale merely because the scanner's own rules didn't trigger on it (e.g. a non-checked attribute)", () => {
    // "Deliberately allowed literal" IS present in Allowed.tsx's source, but
    // only as JSX text (which the scanner WOULD flag) — simulate the OSM
    // attribution case by pointing the allowlist at text this scanner's
    // rules structurally can't reach, while it's still textually present.
    const allowlist = [
      { file: "components/Allowed.tsx", text: "Allowed", reason: "fixture: substring present, no direct match" },
    ];

    const { unusedAllowlistEntries } = scanForUntranslatedLiterals({ root: fixtureRoot, allowlist });

    // "Allowed" is a substring of the file's actual content (the function
    // name), so it's present in source and must not be reported as stale —
    // it only wasn't "used" because no finding's text equals it exactly.
    expect(unusedAllowlistEntries).toEqual([]);
  });

  it("reports the real project's catalog as clean (regression guard for the actual codebase)", () => {
    const { violations, unusedAllowlistEntries } = scanForUntranslatedLiterals();

    expect(violations).toEqual([]);
    expect(unusedAllowlistEntries).toEqual([]);
  });
});
