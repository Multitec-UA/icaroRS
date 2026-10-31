import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { rocketSummaryFromManifest } from "@/lib/domain/rocket";
import { RocketSummaryCard } from "./RocketSummaryCard";

const MANIFEST = {
  id: { rocket_name: "Icarus Mk II" },
  rocket: { mass: 7.84, radius: 0.0635 },
  motors: {
    grain_density: 1800,
    grain_initial_inner_radius: 0.01,
    grain_outer_radius: 0.02,
    grain_initial_height: 0.5,
    grain_number: 1,
  },
  parachutes: { "0": { name: "Drogue" }, "1": { name: "Main" } },
  flight: { rail_length: 5.2, inclination: 85, heading: 90 },
  stored_results: { max_altitude: 1832.4, max_velocity: 291.7, flight_time: 128.3 },
};

function renderCard(manifest: unknown, compact = false) {
  return render(
    <LocaleProvider initialLocale="en">
      <RocketSummaryCard
        summary={rocketSummaryFromManifest(manifest)}
        name="Icarus Mk II"
        file="icarus-mk2-v3.ork"
        compact={compact}
      />
    </LocaleProvider>,
  );
}

function valueOf(term: string): HTMLElement {
  const dt = screen.getByText(term, { selector: "dt" });
  return within(dt.parentElement as HTMLElement).getByRole("definition");
}

describe("RocketSummaryCard (S3)", () => {
  it("shows the rocket's identity, metrics, stored results and the ready line", () => {
    renderCard(MANIFEST);
    expect(screen.getByText("Rocket")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Icarus Mk II" })).toBeInTheDocument();
    expect(screen.getByText("icarus-mk2-v3.ork")).toBeInTheDocument();
    expect(valueOf("Dry mass")).toHaveTextContent("7.84 kg");
    expect(valueOf("Liftoff mass")).toHaveTextContent("8.69 kg");
    expect(valueOf("Diameter")).toHaveTextContent("127 mm");
    expect(valueOf("Motor")).toHaveTextContent("0.85 kg propellant");
    expect(valueOf("Parachutes")).toHaveTextContent("2");
    expect(valueOf("Parachutes")).toHaveTextContent("Drogue · Main");
    expect(valueOf("Rail defaults")).toHaveTextContent("5.2 m · 85° · 90°");
    expect(screen.getByText("OpenRocket stored results")).toBeInTheDocument();
    expect(screen.getByText("its own conditions, saved in the file")).toBeInTheDocument();
    expect(screen.getByText("1,832 m")).toBeInTheDocument();
    expect(screen.getByText("Ready to run")).toBeInTheDocument();
    expect(
      screen.getByText("Review the scenario on the left, then run the simulation. Results appear here."),
    ).toBeInTheDocument();
  });

  it("renders missing manifest fields as a dash, never undefined or NaN", () => {
    const { container } = renderCard({});
    expect(valueOf("Dry mass")).toHaveTextContent("—");
    expect(valueOf("Motor")).toHaveTextContent("—");
    expect(valueOf("Rail defaults")).toHaveTextContent("—");
    expect(screen.queryByText("OpenRocket stored results")).toBeNull();
    expect(container.textContent).not.toMatch(/undefined|NaN|null/);
  });

  it("compact form keeps the metrics but drops the ready line", () => {
    renderCard(MANIFEST, true);
    expect(valueOf("Dry mass")).toHaveTextContent("7.84 kg");
    expect(screen.queryByText("Ready to run")).toBeNull();
  });
});
