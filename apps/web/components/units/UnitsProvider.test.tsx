import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { UnitsProvider, useUnits } from "./UnitsProvider";
import { UnitsToggle } from "./UnitsToggle";

function Probe() {
  const { system, format } = useUnits();
  return (
    <p>
      {system}: {format(10.7, "speed")}
    </p>
  );
}

afterEach(() => {
  document.cookie = "icaro-units=; max-age=0; path=/";
});

describe("UnitsProvider + UnitsToggle", () => {
  it("starts from the server-resolved system and formats through it", () => {
    render(
      <LocaleProvider initialLocale="en">
        <UnitsProvider initialSystem="imperial">
          <Probe />
        </UnitsProvider>
      </LocaleProvider>,
    );
    expect(screen.getByText("imperial: 35.1 ft/s")).toBeInTheDocument();
  });

  it("toggles, re-formats everything and persists the choice in a cookie", () => {
    render(
      <LocaleProvider initialLocale="en">
        <UnitsProvider initialSystem="metric">
          <Probe />
          <UnitsToggle />
        </UnitsProvider>
      </LocaleProvider>,
    );
    expect(screen.getByText("metric: 10.7 m/s")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Switch to imperial units" }));

    expect(screen.getByText("imperial: 35.1 ft/s")).toBeInTheDocument();
    expect(document.cookie).toContain("icaro-units=imperial");
    expect(screen.getByRole("button", { name: "Switch to metric units" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("useUnits — outside a UnitsProvider", () => {
  it("falls back to metric in the current locale, byte-identical to the metric provider", () => {
    render(
      <LocaleProvider initialLocale="es">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText("metric: 10,7 m/s")).toBeInTheDocument();
  });
});
