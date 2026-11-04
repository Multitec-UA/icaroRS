import { describe, expect, it } from "vitest";
import { fileLabel } from "./exports";

describe("fileLabel", () => {
  it("adds the import version to a file imported more than once", () => {
    expect(fileLabel("MT1-v1.6.0.ork", 3)).toBe("MT1-v1.6.0.ork v3");
  });

  it("leaves a file imported once as it is", () => {
    expect(fileLabel("MT1-v1.6.1.ork", null)).toBe("MT1-v1.6.1.ork");
    expect(fileLabel("MT1-v1.6.1.ork", undefined)).toBe("MT1-v1.6.1.ork");
  });

  it("falls back when there is no file name, never inventing a version", () => {
    expect(fileLabel(null, 2, "exp-1")).toBe("exp-1");
    expect(fileLabel(undefined, null)).toBe("");
  });
});
