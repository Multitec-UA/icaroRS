import { describe, expect, it } from "vitest";
import { getServerT, resolveServerLocale } from "./server-i18n";

describe("resolveServerLocale", () => {
  it("uses the cookie value when it's a supported locale", () => {
    expect(resolveServerLocale("es")).toBe("es");
    expect(resolveServerLocale("en")).toBe("en");
  });

  it("falls back to en for an unsupported or missing cookie", () => {
    expect(resolveServerLocale(undefined)).toBe("en");
    expect(resolveServerLocale("fr")).toBe("en");
  });
});

describe("getServerT", () => {
  it("translates a real catalog key without needing LocaleProvider to have rendered", () => {
    const t = getServerT("en");
    expect(t("rockets.heading")).toBe("Your rockets");
  });

  it("resolves the other locale's catalog too", () => {
    const t = getServerT("es");
    expect(t("rockets.heading")).toBe("Tus cohetes");
  });
});
