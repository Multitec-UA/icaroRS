import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { MonteCarloExplainer } from "./MonteCarloExplainer";

describe("MonteCarloExplainer (S15) — how to read a dispersion run", () => {
  it("is collapsed by default and opens on its summary", () => {
    render(
      <LocaleProvider initialLocale="en">
        <MonteCarloExplainer />
      </LocaleProvider>,
    );
    const summary = screen.getByText("How to read these results");
    const details = summary.closest("details")!;
    expect(details.open).toBe(false);

    fireEvent.click(summary);

    expect(details.open).toBe(true);
    expect(screen.getByText(/A Monte Carlo run repeats the same simulation many times/)).toBeVisible();
    expect(screen.getByText(/a spread, not a single number/)).toBeInTheDocument();
    expect(screen.getByText(/size the safety area/)).toBeInTheDocument();
    expect(screen.getByText(/measure it better/)).toBeInTheDocument();
  });

  it("reads in Spanish too", () => {
    render(
      <LocaleProvider initialLocale="es">
        <MonteCarloExplainer />
      </LocaleProvider>,
    );
    expect(screen.getByText("Cómo leer estos resultados")).toBeInTheDocument();
  });
});
