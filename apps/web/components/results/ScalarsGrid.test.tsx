import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { ScalarsGrid } from "./ScalarsGrid";

describe("ScalarsGrid (issue #52 — client island for the results page)", () => {
  it("renders a label for each primary scalar present in the result", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <ScalarsGrid scalars={{ apogee_m: 1234.5, max_velocity_ms: 210.3 }} />
      </LocaleProvider>,
    );

    expect(await screen.findByText("Highest point above ground (apogee)")).toBeInTheDocument();
    expect(screen.getByText("Maximum speed")).toBeInTheDocument();
  });

  it("shows a dash for a non-finite scalar instead of animating a garbage value", () => {
    render(
      <LocaleProvider initialLocale="en">
        <ScalarsGrid scalars={{ apogee_m: null, max_velocity_ms: 210.3 }} />
      </LocaleProvider>,
    );

    expect(screen.getByText("—")).toBeInTheDocument();
  });
});
