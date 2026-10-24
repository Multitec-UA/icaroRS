import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { Trajectory3D } from "./Trajectory3D";

// WebGL has no jsdom equivalent. The Canvas becomes a plain wrapper, the drei
// helpers render nothing, and OrbitControls exposes its `autoRotate` prop so
// the play/pause ↔ auto-rotate coupling stays observable.
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

// Overrides the global inert stub so a test can flip the preference.
const motionState = vi.hoisted(() => ({ reduce: false }));
vi.mock("motion/react", () => ({
  useReducedMotion: () => motionState.reduce,
}));

afterEach(() => {
  motionState.reduce = false;
});

const path: [number, number, number][] = [
  [0, 0, 0],
  [10, 5, 100],
  [20, 10, 0],
];

function renderTrajectory() {
  return render(
    <LocaleProvider initialLocale="en">
      <Trajectory3D path={path} />
    </LocaleProvider>,
  );
}

describe("Trajectory3D — playback controls and accessible canvas", () => {
  it("names the 3D canvas and formats the progress with Intl", () => {
    renderTrajectory();

    expect(
      screen.getByRole("img", {
        name: "3D flight trajectory. Use the timeline slider to scrub the flight.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  it("stops the auto-rotation together with playback", () => {
    renderTrajectory();

    expect(screen.getByTestId("orbit")).toHaveAttribute("data-auto-rotate", "true");

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByTestId("orbit")).toHaveAttribute("data-auto-rotate", "false");
  });

  it("starts paused and without auto-rotation under reduced motion", () => {
    motionState.reduce = true;
    renderTrajectory();

    expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
    expect(screen.getByTestId("orbit")).toHaveAttribute("data-auto-rotate", "false");
  });
});
