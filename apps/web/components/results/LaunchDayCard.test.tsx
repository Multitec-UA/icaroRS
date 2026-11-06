import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { ApiError } from "@/lib/api";
import { SWEEP, candidate } from "@/components/workbench/launchDayFixtures";
import { LaunchDayCard, type LaunchDayCardProps } from "./LaunchDayCard";

function renderCard(props: Partial<LaunchDayCardProps> = {}) {
  const onRun = vi.fn();
  const onApply = vi.fn();
  render(
    <LocaleProvider initialLocale="en">
      <LaunchDayCard
        status="idle"
        result={null}
        error={null}
        disabledReason={null}
        applied={false}
        onRun={onRun}
        onApply={onApply}
        {...props}
      />
    </LocaleProvider>,
  );
  return { onRun, onApply };
}

describe("LaunchDayCard (launch-day S6b)", () => {
  it("idle: says what the sweep does and offers to run it", () => {
    const { onRun } = renderCard();
    expect(
      screen.getByText(
        "Flies the rocket 72 times, with the rail inclined 80–90° and pointed every 30° from 0° to 330°, and picks the setting that lands closest to the pad.",
      ),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recommend rail setting" }));
    expect(onRun).toHaveBeenCalledTimes(1);
  });

  it("idle without a site: the button is disabled with the reason", () => {
    renderCard({ disabledReason: "Place the launch site on the map first." });
    expect(screen.getByRole("button", { name: "Recommend rail setting" })).toBeDisabled();
    expect(screen.getByText("Place the launch site on the map first.")).toBeInTheDocument();
  });

  it("running: says how long it takes and blocks a second run", () => {
    renderCard({ status: "running" });
    expect(screen.getByText("Simulating 72 flights… about 1–2 minutes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recommend rail setting" })).toBeDisabled();
  });

  it("error: shows the message and lets the user try again", () => {
    renderCard({ status: "error", error: new ApiError(404, "nope") });
    expect(screen.getByText("This file is no longer available.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recommend rail setting" })).toBeEnabled();
  });

  it("done: headline with the best setting and the wind used", () => {
    renderCard({ status: "done", result: SWEEP });
    expect(
      screen.getByText("Inclination 86°, heading 240° (SW): lands about 120 m to the NE of the pad."),
    ).toBeInTheDocument();
    expect(screen.getByText("Wind used: 18 km/h from 270° (measured)")).toBeInTheDocument();
    expect(screen.getByText("1 setting could not be simulated.")).toBeInTheDocument();
  });

  it("done with the forecast wind says so", () => {
    renderCard({ status: "done", result: { ...SWEEP, wind: { speed: 2.5, direction_from: 90, source: "model" } } });
    expect(screen.getByText("Wind used: 9 km/h from 90° (forecast)")).toBeInTheDocument();
  });

  it("done without a passing setting names the closest one", () => {
    renderCard({ status: "done", result: { ...SWEEP, best: candidate(80, 0, 640, false) } });
    expect(
      screen.getByText(
        "No setting passes every hard check; the closest is inclination 80°, heading 0° (N), landing about 640 m to the NE of the pad.",
      ),
    ).toBeInTheDocument();
  });

  it("done: a table of the 8 closest settings with their checks", () => {
    renderCard({ status: "done", result: SWEEP });
    const table = screen.getByRole("table", { name: "Closest settings" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(8);
    const first = within(rows[0]).getAllByRole("cell").map((cell) => cell.textContent);
    expect(first).toEqual(["86°", "240° (SW)", "123 m", "540 m", "22.1 m/s", "1.8 cal", "✓Passes"]);
    expect(within(rows[3]).getByText("Fails")).toBeInTheDocument();
  });

  it("done: Apply to rail hands the best setting over, then confirms", () => {
    const { onApply } = renderCard({ status: "done", result: SWEEP });
    fireEvent.click(screen.getByRole("button", { name: "Apply to rail" }));
    expect(onApply).toHaveBeenCalledWith(SWEEP.best);
  });

  it("done: confirms an applied setting", () => {
    renderCard({ status: "done", result: SWEEP, applied: true });
    expect(
      screen.getByText("Applied: the next Run and Dispersion use inclination 86° and heading 240°."),
    ).toBeInTheDocument();
  });

  it("done: the checklists for the current and the recommended setting", () => {
    renderCard({ status: "done", result: SWEEP });
    expect(screen.getByRole("table", { name: "Current setting" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Recommended setting" })).toBeInTheDocument();
  });
});
