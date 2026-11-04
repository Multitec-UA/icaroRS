import { afterEach, describe, expect, it, vi } from "vitest";
import { clearDrafts, draftKey, loadDraft, saveDraft, type StoredDraft } from "./draft-storage";

const DRAFT: StoredDraft = {
  runId: "run-4",
  site: { latitude: 38.2655, longitude: -0.6981, elevation: 120 },
  launchDatetime: "2026-11-07T11:00",
  atmosphere: { model: "standard_atmosphere", file: null, station: null, fallback: "standard_atmosphere" },
  railOverrides: { length: 5.2 },
};

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("draft storage — the Workbench draft kept per export for a refresh (S12l)", () => {
  it("saves under icaro:draft:{exportId} and loads it back", () => {
    saveDraft("exp-1", DRAFT);
    expect(draftKey("exp-1")).toBe("icaro:draft:exp-1");
    expect(JSON.parse(sessionStorage.getItem("icaro:draft:exp-1") ?? "null")).toEqual(DRAFT);
    expect(loadDraft("exp-1")).toEqual(DRAFT);
    expect(loadDraft("exp-2")).toBeNull();
  });

  it("clears every stored draft and leaves other keys alone", () => {
    saveDraft("exp-1", DRAFT);
    saveDraft("exp-2", { ...DRAFT, runId: null });
    sessionStorage.setItem("other", "kept");

    clearDrafts();

    expect(loadDraft("exp-1")).toBeNull();
    expect(loadDraft("exp-2")).toBeNull();
    expect(sessionStorage.getItem("other")).toBe("kept");
  });

  it("ignores a corrupt or foreign entry", () => {
    sessionStorage.setItem("icaro:draft:exp-1", "{not json");
    expect(loadDraft("exp-1")).toBeNull();
    sessionStorage.setItem("icaro:draft:exp-1", JSON.stringify({ site: 3 }));
    expect(loadDraft("exp-1")).toBeNull();
  });

  it("never throws when storage is unavailable (private mode, quota)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => saveDraft("exp-1", DRAFT)).not.toThrow();
    expect(loadDraft("exp-1")).toBeNull();
    expect(() => clearDrafts()).not.toThrow();
  });
});
