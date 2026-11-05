import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { MonteCarloLauncher } from "./MonteCarloLauncher";

function wrap(node: ReactNode) {
  return render(<LocaleProvider initialLocale="en">{node}</LocaleProvider>);
}

function open() {
  fireEvent.click(screen.getByRole("button", { name: "Dispersion" }));
  return screen.getByRole("spinbutton", { name: "Flights" });
}

describe("MonteCarloLauncher (S12) — launching a dispersion run", () => {
  it("opens a panel with 100 flights by default and a time estimate", () => {
    wrap(<MonteCarloLauncher disabledReason={null} submitting={false} error={null} onLaunch={() => {}} />);
    expect(screen.queryByRole("spinbutton", { name: "Flights" })).toBeNull();

    const flights = open();

    expect(screen.getByRole("button", { name: "Dispersion" })).toHaveAttribute("aria-expanded", "true");
    expect(flights).toHaveValue(100);
    expect(flights).toHaveAttribute("min", "10");
    expect(flights).toHaveAttribute("max", "500");
    expect(screen.getByText("10–500 flights · ≈ 1 min")).toBeInTheDocument();
  });

  it("keeps the count within 10..500 and updates the estimate", () => {
    wrap(<MonteCarloLauncher disabledReason={null} submitting={false} error={null} onLaunch={() => {}} />);
    const flights = open();

    fireEvent.change(flights, { target: { value: "900" } });
    fireEvent.blur(flights);
    expect(flights).toHaveValue(500);
    expect(screen.getByText("10–500 flights · ≈ 4 min")).toBeInTheDocument();

    fireEvent.change(flights, { target: { value: "3" } });
    fireEvent.blur(flights);
    expect(flights).toHaveValue(10);

    fireEvent.change(screen.getByRole("slider", { name: "Flights slider" }), { target: { value: "300" } });
    expect(flights).toHaveValue(300);
  });

  it("submits the chosen count, clamped even without a blur", async () => {
    const onLaunch = vi.fn();
    wrap(<MonteCarloLauncher disabledReason={null} submitting={false} error={null} onLaunch={onLaunch} />);
    const flights = open();

    fireEvent.change(flights, { target: { value: "250" } });
    fireEvent.click(screen.getByRole("button", { name: "Run dispersion" }));
    expect(onLaunch).toHaveBeenLastCalledWith(250);
    // A queued launch closes the panel; the run shows in the results column.
    await waitFor(() => expect(screen.queryByRole("spinbutton", { name: "Flights" })).toBeNull());

    const again = open();
    expect(again).toHaveValue(250);
    fireEvent.change(again, { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: "Run dispersion" }));
    expect(onLaunch).toHaveBeenLastCalledWith(500);
  });

  it("stays open when the launch was refused", async () => {
    const onLaunch = vi.fn().mockResolvedValue(false);
    wrap(<MonteCarloLauncher disabledReason={null} submitting={false} error={null} onLaunch={onLaunch} />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Run dispersion" }));
    await waitFor(() => expect(onLaunch).toHaveBeenCalledWith(100));
    expect(screen.getByRole("spinbutton", { name: "Flights" })).toBeInTheDocument();
  });

  it("says why it cannot launch, and shows a submit error", () => {
    const onLaunch = vi.fn();
    wrap(
      <MonteCarloLauncher
        disabledReason="Pick a launch site first"
        submitting={false}
        error="n must be between 10 and 500, got 5."
        onLaunch={onLaunch}
      />,
    );
    open();
    const submit = screen.getByRole("button", { name: "Run dispersion" });
    expect(submit).toBeDisabled();
    expect(screen.getByText("Pick a launch site first")).toBeInTheDocument();
    expect(screen.getByText("n must be between 10 and 500, got 5.")).toBeInTheDocument();
    fireEvent.click(submit);
    expect(onLaunch).not.toHaveBeenCalled();
  });

  it("is busy while the run is being queued", () => {
    wrap(<MonteCarloLauncher disabledReason={null} submitting error={null} onLaunch={() => {}} />);
    open();
    expect(screen.getByRole("button", { name: "Queuing…" })).toBeDisabled();
  });
});
