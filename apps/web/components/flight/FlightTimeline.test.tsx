import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { ReplayProvider } from "./ReplayContext";
import { FlightReplay } from "./FlightReplay";
import { FlightTimeline } from "./FlightTimeline";
import { SCALARS, SERIES } from "./fixtures";

vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div data-testid="canvas">{children}</div>,
  useFrame: () => {},
}));

vi.mock("@react-three/drei", () => ({
  Grid: () => null,
  Line: () => null,
  OrbitControls: () => <div data-testid="orbit" />,
}));

const motionState = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async () => (await import("./testMotionStub")).makeMotionStub(motionState));

function renderTimeline(scalars: Record<string, number>) {
  return render(
    <LocaleProvider initialLocale="en">
      <ReplayProvider>
        <FlightTimeline scalars={scalars} />
      </ReplayProvider>
    </LocaleProvider>,
  );
}

describe("FlightTimeline — events derived from the scalars", () => {
  it("lists the events in time order with their time, label and value", () => {
    renderTimeline(SCALARS);

    // Values carry a non-breaking space before the unit, hence `\s`.

    const rows = within(screen.getByRole("list", { name: "Flight timeline" })).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/^0\.41\ss.*Leaves rail.*27\.3\sm\/s$/),
      expect.stringMatching(/^0\.9\ss.*Max acceleration.*95\.3\sm\/s²$/),
      expect.stringMatching(/^3\.1\ss.*Max speed.*287\sm\/s$/),
      expect.stringMatching(/^21\.8\ss.*Apogee.*3,142\sm$/),
      expect.stringMatching(/^142\ss.*Landing.*8\.4\sm\/s$/),
    ]);
  });

  it("only lists events whose time is a finite number", () => {
    const withoutAccel: Record<string, number> = { ...SCALARS, apogee_time_s: Number.NaN };
    delete withoutAccel.max_acceleration_time_s;
    renderTimeline(withoutAccel);

    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(screen.queryByText("Max acceleration")).toBeNull();
    expect(screen.queryByText("Apogee")).toBeNull();
  });

  it("renders nothing when no event has a time", () => {
    const { container } = renderTimeline({ apogee_m: 3142 });
    expect(container).toBeEmptyDOMElement();
  });

  it("seeks the replay to the event's time when a row is activated", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <ReplayProvider>
          <FlightReplay series={{ ...SERIES, t: [0, 10, 20, 30] }} scalars={SCALARS} />
          <FlightTimeline scalars={SCALARS} />
        </ReplayProvider>
      </LocaleProvider>,
    );
    await screen.findByTestId("orbit");

    fireEvent.click(screen.getByRole("button", { name: /^Apogee, jump the replay to 21\.8\ss$/ }));

    expect(screen.getByRole("slider", { name: "Scrub flight timeline" })).toHaveValue("21.8");
    expect(screen.getByText("21.8 / 30 s")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });
});
