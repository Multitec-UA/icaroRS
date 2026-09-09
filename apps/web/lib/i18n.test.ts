import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeT, plural, registerCatalog } from "./i18n";

// Fixture catalog registered before each test — keeps the module-level
// `catalogs` registry (see registerCatalog in i18n.ts) deterministic and
// independent of the real messages/en.json content.
const FIXTURE = {
  greeting: "Hello, {name}!",
  nested: { deep: { value: "found it" } },
  results: {
    valuesBadge: { one: "1 value", other: "{count} values" },
  },
};

beforeEach(() => {
  registerCatalog("en", FIXTURE);
});

describe("makeT — dot-path resolution", () => {
  it("resolves a top-level key", () => {
    const t = makeT("en");
    expect(t("nested.deep.value")).toBe("found it");
  });

  it("resolves a nested dot-path key", () => {
    const t = makeT("en");
    expect(t("results.valuesBadge.one")).toBe("1 value");
  });

  it("falls back to the key itself for a missing key, and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t = makeT("en");

    expect(t("does.not.exist")).toBe("does.not.exist");
    expect(warn).toHaveBeenCalledTimes(1);

    warn.mockRestore();
  });

  it("falls back to the key when a path segment is not an object", () => {
    const t = makeT("en");
    // "greeting" resolves to a string; "greeting.nope" tries to index into it.
    expect(t("greeting.nope")).toBe("greeting.nope");
  });

  it("falls back to the key when the resolved value is not a string", () => {
    registerCatalog("en", { obj: { a: 1 } });
    const t = makeT("en");
    expect(t("obj")).toBe("obj");
  });
});

describe("makeT — interpolation", () => {
  it("substitutes a {var} placeholder", () => {
    const t = makeT("en");
    expect(t("greeting", { name: "Ada" })).toBe("Hello, Ada!");
  });

  it("substitutes a numeric var by coercing to string", () => {
    registerCatalog("en", { count: "{n} items" });
    const t = makeT("en");
    expect(t("count", { n: 3 })).toBe("3 items");
  });

  it("leaves the placeholder untouched when vars is omitted", () => {
    const t = makeT("en");
    expect(t("greeting")).toBe("Hello, {name}!");
  });

  it("leaves an unmatched placeholder untouched", () => {
    const t = makeT("en");
    expect(t("greeting", { other: "x" })).toBe("Hello, {name}!");
  });
});

describe("plural", () => {
  it("picks .one when count === 1", () => {
    expect(plural("en", 1, "results.valuesBadge")).toBe("1 value");
  });

  it("picks .other when count === 0", () => {
    expect(plural("en", 0, "results.valuesBadge")).toBe("0 values");
  });

  it("picks .other when count > 1, interpolating {count}", () => {
    expect(plural("en", 3, "results.valuesBadge")).toBe("3 values");
  });

  it("falls back to the derived key when the sub-key is missing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registerCatalog("en", { results: {} });

    expect(plural("en", 2, "results.valuesBadge")).toBe("results.valuesBadge.other");

    warn.mockRestore();
  });
});
