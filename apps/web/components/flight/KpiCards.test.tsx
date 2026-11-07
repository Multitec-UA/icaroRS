import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { UnitsProvider } from "@/components/units/UnitsProvider";
import { KpiCards } from "./KpiCards";
import { SCALARS, SERIES, WIND_SCALARS } from "./fixtures";

// CountUp settles instantly and the reduced-motion flag is ours to flip.
const motionState = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async () => (await import("./testMotionStub")).makeMotionStub(motionState));

function renderCards(scalars: Record<string, number>, series = SERIES) {
  return render(
    <LocaleProvider initialLocale="en">
      <KpiCards scalars={scalars} series={series} />
    </LocaleProvider>,
  );
}

describe("KpiCards — the four headline numbers", () => {
  it("shows apogee, max speed, stability off rail and landing with their captions", () => {
    renderCards(SCALARS);

    const apogee = screen.getByRole("group", { name: "Apogee" });
    expect(within(apogee).getByText("3,142")).toBeInTheDocument();
    expect(apogee).toHaveTextContent("3,142 m");
    expect(apogee).toHaveTextContent("at 21.8 s");

    const speed = screen.getByRole("group", { name: "Max speed" });
    expect(speed).toHaveTextContent("287 m/s");
    expect(speed).toHaveTextContent("Mach 0.84");

    const stability = screen.getByRole("group", { name: "Stability off rail" });
    expect(stability).toHaveTextContent("1.93 cal");
    expect(stability).toHaveTextContent("27.3 m/s off the rail");

    const landing = screen.getByRole("group", { name: "Landing" });
    expect(landing).toHaveTextContent("8.4 m/s at impact");
  });

  it("computes the landing distance from the pad as the hypotenuse of the impact offsets", () => {
    renderCards({ ...SCALARS, impact_x_m: 1200, impact_y_m: 900 });
    // √(1200² + 900²) = 1500 m, shown in km once past a kilometre.
    expect(screen.getByRole("group", { name: "Landing" })).toHaveTextContent("1.5 km");
  });

  it("keeps the landing distance in metres under a kilometre", () => {
    renderCards({ ...SCALARS, impact_x_m: 300, impact_y_m: 400 });
    expect(screen.getByRole("group", { name: "Landing" })).toHaveTextContent("500 m");
  });

  it("renders a dash for every missing scalar and never NaN", () => {
    const { container } = renderCards({});

    expect(screen.getAllByText("—")).toHaveLength(4);
    expect(container.textContent).not.toMatch(/NaN/);
    expect(container.textContent).not.toMatch(/Infinity/);
  });

  it("draws one sparkline per card from the series", () => {
    const { container } = renderCards(SCALARS);
    expect(container.querySelectorAll("svg path[data-sparkline]")).toHaveLength(4);
  });

  it("skips the sparklines when there is no series (runs that predate the feature)", () => {
    const { container } = render(
      <LocaleProvider initialLocale="en">
        <KpiCards scalars={SCALARS} />
      </LocaleProvider>,
    );
    expect(container.querySelectorAll("svg path[data-sparkline]")).toHaveLength(0);
    expect(screen.getByRole("group", { name: "Apogee" })).toHaveTextContent("3,142 m");
  });

  it("formats the numbers for the active locale", () => {
    render(
      <LocaleProvider initialLocale="es">
        <KpiCards scalars={SCALARS} series={SERIES} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("group", { name: "Apogeo" })).toHaveTextContent("3142 m");
    expect(screen.getByRole("group", { name: "Velocidad máxima" })).toHaveTextContent("Mach 0,84");
  });
});

describe("KpiCards — imperial units", () => {
  it("shows apogee in ft, speeds in ft/s and the landing distance in ft; stability stays in cal", () => {
    render(
      <LocaleProvider initialLocale="en">
        <UnitsProvider initialSystem="imperial">
          <KpiCards scalars={SCALARS} series={SERIES} />
        </UnitsProvider>
      </LocaleProvider>,
    );
    expect(screen.getByRole("group", { name: "Apogee" })).toHaveTextContent("10,309 ft");
    expect(screen.getByRole("group", { name: "Max speed" })).toHaveTextContent("943 ft/s");
    const stability = screen.getByRole("group", { name: "Stability off rail" });
    expect(stability).toHaveTextContent("1.93 cal");
    expect(stability).toHaveTextContent("89.6 ft/s off the rail");
    // 1500 m = 4,921 ft: still feet under a mile.
    const landing = screen.getByRole("group", { name: "Landing" });
    expect(landing).toHaveTextContent("4,921 ft");
    expect(landing).toHaveTextContent("27.6 ft/s at impact");
  });

  it("switches the landing distance to miles past one mile", () => {
    render(
      <LocaleProvider initialLocale="en">
        <UnitsProvider initialSystem="imperial">
          <KpiCards scalars={{ ...SCALARS, impact_x_m: 3000, impact_y_m: 4000 }} />
        </UnitsProvider>
      </LocaleProvider>,
    );
    // 5 km = 3.11 mi.
    expect(screen.getByRole("group", { name: "Landing" })).toHaveTextContent("3.11 mi");
  });
});

describe("KpiCards — rail-exit stability with the wind", () => {
  it("shows the static margin, the margin with wind and the angle of attack", () => {
    renderCards(WIND_SCALARS);
    const stability = screen.getByRole("group", { name: "Stability off rail" });
    expect(stability).toHaveTextContent("1.93 cal");
    expect(stability).toHaveTextContent("1.42 cal with wind");
    expect(stability).toHaveTextContent("27.3 m/s off the rail · 6.97° angle of attack");
  });

  it("explains the margin with wind in an InfoTip", () => {
    renderCards(WIND_SCALARS);
    const stability = screen.getByRole("group", { name: "Stability off rail" });
    fireEvent.click(within(stability).getByRole("button", { name: "More information" }));
    expect(screen.getByRole("status")).toHaveTextContent(/angle of attack/);
    expect(screen.getByRole("status")).toHaveTextContent(/OpenRocket/);
  });

  it("formats the margin with wind for the active locale", () => {
    render(
      <LocaleProvider initialLocale="es">
        <KpiCards scalars={WIND_SCALARS} series={SERIES} />
      </LocaleProvider>,
    );
    const stability = screen.getByRole("group", { name: "Estabilidad al salir del riel" });
    expect(stability).toHaveTextContent("1,42 cal con viento");
  });

  it("renders the card exactly as before when the run has no margin with wind", () => {
    const { container: before } = renderCards(SCALARS);
    const html = before.innerHTML;
    expect(html).not.toMatch(/with wind/);
    expect(screen.queryByRole("button", { name: "More information" })).toBeNull();
  });
});
