import { describe, expect, it } from "vitest";

import { rocketNameFor } from "./useOrkImport";

const file = new File(["x"], "icarus-mk2-v3.ork");

describe("rocketNameFor", () => {
  it("reads the serializer's id.rocket_name", () => {
    expect(rocketNameFor(file, { id: { rocket_name: "Icarus Mk II" } })).toBe("Icarus Mk II");
  });

  it("still honours a top-level name", () => {
    expect(rocketNameFor(file, { name: "Icarus-3" })).toBe("Icarus-3");
  });

  it("falls back to the file name without .ork", () => {
    expect(rocketNameFor(file, {})).toBe("icarus-mk2-v3");
    expect(rocketNameFor(file, { id: { rocket_name: "  " } })).toBe("icarus-mk2-v3");
  });
});
