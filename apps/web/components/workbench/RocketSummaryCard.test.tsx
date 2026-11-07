import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { UnitsProvider } from "@/components/units/UnitsProvider";
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

  it("keeps a legacy manifest's motor as the propellant alone, with no pill and today's note", () => {
    renderCard(MANIFEST);
    expect(valueOf("Motor").textContent).toBe("0.85 kg propellant");
    expect(screen.queryByRole("status")).toBeNull();
  });
});

const IDENTITY = {
  designation: "232H123-14A",
  manufacturer: "Cesaroni Technology",
  ork_motor_type: "reload",
  config_id: "cfg-1",
  motor_count: 1,
  impulse_class: "H",
  total_impulse_newton_seconds: 232,
  impulse_check: "ok",
  burn_time_seconds: 1.94,
};

function enriched(identity: Partial<typeof IDENTITY> | null, status: string | null = "uptodate") {
  return {
    ...MANIFEST,
    motors: { ...MANIFEST.motors, ...(identity && { identity: { ...IDENTITY, ...identity } }) },
    stored_results: { ...MANIFEST.stored_results, simulation_name: "Simulation 1", status, selection: "uptodate_default" },
  };
}

const STALE_NOTE = "May not reflect the current design or settings; re-run the simulation in OpenRocket to refresh.";

describe("RocketSummaryCard (S4) — motor identity", () => {
  it("names the motor and lists impulse, burn time and propellant", () => {
    renderCard(enriched({}));
    const motor = valueOf("Motor");
    expect(motor).toHaveTextContent("Cesaroni Technology 232H123-14A");
    expect(motor).toHaveTextContent("232 N·s · 1.94 s burn · 0.85 kg propellant");
  });

  it("shows each part only when present", () => {
    renderCard(enriched({ manufacturer: null as never, total_impulse_newton_seconds: null as never }));
    const motor = valueOf("Motor");
    expect(motor).toHaveTextContent(/^232H123-14A1\.94 s burn · 0\.85 kg propellant$/);
  });

  it("shows the same motor line in the compact card", () => {
    renderCard(enriched({}), true);
    expect(valueOf("Motor")).toHaveTextContent("Cesaroni Technology 232H123-14A");
    expect(valueOf("Motor")).toHaveTextContent("232 N·s · 1.94 s burn · 0.85 kg propellant");
  });
});

describe("RocketSummaryCard (S4) — stored-results provenance", () => {
  it("titles the block with the simulation name and marks an up-to-date simulation", () => {
    renderCard(enriched({}, "uptodate"));
    expect(screen.getByText("OpenRocket stored results · Simulation 1")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("up to date");
    expect(screen.getByText("its own conditions, saved in the file")).toBeInTheDocument();
    expect(screen.queryByText(STALE_NOTE)).toBeNull();
  });

  it.each([
    ["outdated", "outdated", "bg-warn-soft"],
    ["loaded", "loaded", "bg-chip"],
  ])("marks a %s simulation and warns it may be stale", (status, label, toneClass) => {
    renderCard(enriched({}, status));
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent(label);
    expect(pill.className).toContain(toneClass);
    expect(screen.getByText(STALE_NOTE)).toBeInTheDocument();
  });

  it("shows no pill when the status is unknown", () => {
    renderCard(enriched({}, null));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText("its own conditions, saved in the file")).toBeInTheDocument();
  });
});

describe("RocketSummaryCard — imperial units", () => {
  it("shows masses in lb, the diameter in in, the rail length and stored apogee in ft", () => {
    render(
      <LocaleProvider initialLocale="en">
        <UnitsProvider initialSystem="imperial">
          <RocketSummaryCard summary={rocketSummaryFromManifest(MANIFEST)} name="Icarus Mk II" file="icarus-mk2-v3.ork" />
        </UnitsProvider>
      </LocaleProvider>,
    );
    // 7.84 kg = 17.28 lb; 8.69 kg = 19.16 lb (two decimals, like kg); 127 mm = 5 in; 5.2 m = 17.06 ft.
    expect(valueOf("Dry mass")).toHaveTextContent("17.28 lb");
    expect(valueOf("Liftoff mass")).toHaveTextContent(/^19\.1\d lb/);
    expect(valueOf("Diameter")).toHaveTextContent("5 in");
    expect(valueOf("Motor")).toHaveTextContent(/1\.8\d lb propellant/);
    expect(valueOf("Rail defaults")).toHaveTextContent("17.06 ft · 85° · 90°");
    // Stored results: 1,832.4 m = 6,012 ft; 291.7 m/s = 957 ft/s; time unchanged.
    expect(screen.getByText("6,012 ft")).toBeInTheDocument();
    expect(screen.getByText("957 ft/s")).toBeInTheDocument();
    expect(screen.getByText("128 s")).toBeInTheDocument();
  });
});
