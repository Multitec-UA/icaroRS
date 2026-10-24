import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PlotCard } from "./PlotCard";

describe("PlotCard (issue #52 — client island for the results page)", () => {
  it("renders the image with the given title", () => {
    render(<PlotCard url="/api/results/run-1/plots/energy.png" title="Energy" failedLabel="Couldn't load" />);

    expect(screen.getByText("Energy")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Energy" })).toBeInTheDocument();
  });

  it("reserves the plot's box and defers loading (no layout shift, below the fold)", () => {
    render(<PlotCard url="/api/results/run-1/plots/energy.png" title="Energy" failedLabel="Couldn't load" />);

    const img = screen.getByRole("img", { name: "Energy" });
    expect(img).toHaveAttribute("width", "1200");
    expect(img).toHaveAttribute("height", "900");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).toHaveAttribute("decoding", "async");
  });

  it("swaps to the failed label when the image errors", () => {
    render(<PlotCard url="/api/results/run-1/plots/energy.png" title="Energy" failedLabel="Couldn't load" />);

    fireEvent.error(screen.getByRole("img", { name: "Energy" }));

    expect(screen.getByText("Couldn't load")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
