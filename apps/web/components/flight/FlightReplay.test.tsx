import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { ReplayProvider } from "./ReplayContext";
import { FlightReplay } from "./FlightReplay";
import { SCALARS, SERIES } from "./fixtures";

// WebGL has no jsdom equivalent: the Canvas becomes a wrapper, the drei
// helpers render nothing, and OrbitControls exposes `autoRotate` so the
// play/pause ↔ camera coupling stays observable (same stubs as
// Trajectory3D.test.tsx).
vi.mock("@react-three/fiber", () => ({
  Canvas: ({ children }: { children: ReactNode }) => <div data-testid="canvas">{children}</div>,
  useFrame: () => {},
}));

vi.mock("@react-three/drei", () => ({
  Grid: () => null,
  Line: () => null,
  OrbitControls: ({ autoRotate }: { autoRotate?: boolean }) => (
    <div data-testid="orbit" data-auto-rotate={String(Boolean(autoRotate))} />
  ),
}));

const motionState = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", async () => (await import("./testMotionStub")).makeMotionStub(motionState));

afterEach(() => {
  motionState.reduce = false;
});

async function renderReplay() {
  const view = render(
    <LocaleProvider initialLocale="en">
      <ReplayProvider>
        <FlightReplay series={SERIES} scalars={SCALARS} />
      </ReplayProvider>
    </LocaleProvider>,
  );
  // Trajectory3D is loaded with next/dynamic; wait for the scene to mount.
  await screen.findByTestId("orbit");
  return view;
}

describe("FlightReplay — play/pause, scrubber and speed", () => {
  it("starts playing with the camera orbiting and pauses both on Pause", async () => {
    await renderReplay();

    expect(screen.getByText("Flight replay")).toBeInTheDocument();
    expect(screen.getByText("Drag to orbit · scroll to zoom")).toBeInTheDocument();
    expect(screen.getByTestId("orbit")).toHaveAttribute("data-auto-rotate", "true");

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByTestId("orbit")).toHaveAttribute("data-auto-rotate", "false");
  });

  it("scrubs the flight time with a labelled slider and shows the current second", async () => {
    await renderReplay();

    const slider = screen.getByRole("slider", { name: "Scrub flight timeline" });
    expect(slider).toHaveAttribute("min", "0");
    expect(slider).toHaveAttribute("max", "3");
    expect(screen.getByText("0 / 3 s")).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "1.5" } });

    expect(slider).toHaveValue("1.5");
    expect(screen.getByText("1.5 / 3 s")).toBeInTheDocument();
    // Scrubbing pauses the replay, so the camera stops orbiting too.
    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  });

  it("switches the playback speed between 1× and 4×", async () => {
    await renderReplay();

    const group = screen.getByRole("group", { name: "Playback speed" });
    const one = screen.getByRole("button", { name: "1×" });
    const four = screen.getByRole("button", { name: "4×" });
    expect(group).toContainElement(one);
    expect(one).toHaveAttribute("aria-pressed", "true");
    expect(four).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(four);

    expect(four).toHaveAttribute("aria-pressed", "true");
    expect(one).toHaveAttribute("aria-pressed", "false");
  });

  it("starts paused at the end of the flight under reduced motion, with the scrubber still live", async () => {
    motionState.reduce = true;
    await renderReplay();

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByTestId("orbit")).toHaveAttribute("data-auto-rotate", "false");
    const slider = screen.getByRole("slider", { name: "Scrub flight timeline" });
    expect(slider).toHaveValue("3");
    expect(screen.getByText("3 / 3 s")).toBeInTheDocument();

    fireEvent.change(slider, { target: { value: "2" } });
    expect(screen.getByText("2 / 3 s")).toBeInTheDocument();
  });

  it("summarises the flight in words for assistive tech when the scalars allow it", async () => {
    await renderReplay();

    // √(1200² + 900²) = 1.5 km; the values carry a non-breaking space before the unit.
    expect(screen.getByText(/^Flight from the pad to apogee at 3,142\sm, landing 1\.5\skm from it\.$/)).toHaveClass(
      "sr-only",
    );
  });

  it("writes no summary when the scalars are missing", async () => {
    render(
      <LocaleProvider initialLocale="en">
        <ReplayProvider>
          <FlightReplay series={SERIES} />
        </ReplayProvider>
      </LocaleProvider>,
    );
    await screen.findByTestId("orbit");

    expect(screen.queryByText(/Flight from the pad/)).toBeNull();
  });

  it("shows the altitude and speed at the current time in the live readout", async () => {
    await renderReplay();

    fireEvent.change(screen.getByRole("slider", { name: "Scrub flight timeline" }), {
      target: { value: "2" },
    });

    const readout = screen.getByRole("group", { name: "Flight state at the current time" });
    expect(readout).toHaveTextContent("300 m");
    expect(readout).toHaveTextContent("30 m/s");
  });
});
