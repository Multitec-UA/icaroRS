import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { UnitsProvider } from "@/components/units/UnitsProvider";
import type { LaunchCheck } from "@/lib/api/launchday";
import { LaunchChecklist } from "./LaunchChecklist";

const CHECKS: LaunchCheck[] = [
  { id: "apogee_max", value: 540.4, limit: 1000, comparator: "<=", ok: true, severity: "hard", source: "PROP-003" },
  { id: "descent_recommended", value: 7.2, limit: [5, 6], comparator: "between", ok: false, severity: "soft", source: "REC-003" },
  { id: "static_margin_min", value: 1.21, limit: 1.5, comparator: ">=", ok: false, severity: "hard", source: "PROP-004" },
  { id: "rail_exit_min", value: 18.3, limit: 15, comparator: ">=", ok: true, severity: "soft", source: "practice" },
];

function renderList() {
  return render(
    <LocaleProvider initialLocale="en">
      <LaunchChecklist title="Current setting" checks={CHECKS} />
    </LocaleProvider>,
  );
}

describe("LaunchChecklist (launch-day S6b)", () => {
  it("shows one row per check with its value, limit and requirement id", () => {
    renderList();
    const table = screen.getByRole("table", { name: "Current setting" });
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(4);

    expect(within(rows[0]).getByText("Apogee")).toBeInTheDocument();
    expect(within(rows[0]).getByText("540 m")).toBeInTheDocument();
    expect(within(rows[0]).getByText("≤ 1,000 m · limit")).toBeInTheDocument();
    expect(within(rows[0]).getByText("SURTSR-L1-PROP-003")).toBeInTheDocument();

    expect(within(rows[1]).getByText("5–6 m/s · recommended")).toBeInTheDocument();
    expect(within(rows[2]).getByText("1.21 cal")).toBeInTheDocument();
    expect(within(rows[2]).getByText("≥ 1.5 cal · limit")).toBeInTheDocument();
    expect(within(rows[3]).getByText("Common practice")).toBeInTheDocument();
  });

  it("colours a pass green, a missed recommendation amber and a broken limit red", () => {
    renderList();
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("OK")).toHaveAttribute("data-tone", "ok");
    expect(within(rows[1]).getByText("Recommendation missed")).toHaveAttribute("data-tone", "warn");
    expect(within(rows[2]).getByText("Limit broken")).toHaveAttribute("data-tone", "bad");
    expect(within(rows[3]).getByText("OK")).toHaveAttribute("data-tone", "ok");
  });

  it("explains every rule with an info tip", () => {
    renderList();
    expect(screen.getAllByRole("button", { name: "More information" })).toHaveLength(4);
  });
});

describe("LaunchChecklist — imperial units (units S6)", () => {
  const ALL: LaunchCheck[] = [
    ...CHECKS,
    { id: "descent_max", value: 7.2, limit: 10, comparator: "<=", ok: true, severity: "hard", source: "PROP-005" },
    { id: "landing_radius", value: 610, limit: 500, comparator: "<=", ok: false, severity: "soft", source: "REC-003" },
    { id: "wind_max", value: 18, limit: 32, comparator: "<=", ok: true, severity: "hard", source: "PROP-001" },
    { id: "tilt_max", value: 4, limit: 5, comparator: "<=", ok: true, severity: "hard", source: "PROP-002" },
  ];

  function cells(row: HTMLElement): string[] {
    return within(row).getAllByRole("cell").slice(1, 3).map((cell) => cell.textContent ?? "");
  }

  it("shows values and limits in ft, ft/s and mph; ok still comes from the API", () => {
    render(
      <LocaleProvider initialLocale="en">
        <UnitsProvider initialSystem="imperial">
          <LaunchChecklist title="Current setting" checks={ALL} />
        </UnitsProvider>
      </LocaleProvider>,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map(cells)).toEqual([
      ["1,773 ft", "≤ 3,281 ft · limit"],
      ["23.6 ft/s", "16.4–19.7 ft/s · recommended"],
      ["1.21 cal", "≥ 1.5 cal · limit"],
      ["60 ft/s", "≥ 49.2 ft/s · recommended"],
      ["23.6 ft/s", "≤ 32.8 ft/s · limit"],
      ["2,001 ft", "≤ 1,640 ft · recommended"],
      ["11.2 mph", "≤ 19.9 mph · limit"],
      ["4°", "≤ 5° · limit"],
    ]);
    expect(within(rows[5]).getByText("Recommendation missed")).toHaveAttribute("data-tone", "warn");
  });

  it("metric renders the same limits as before", () => {
    render(
      <LocaleProvider initialLocale="en">
        <UnitsProvider initialSystem="metric">
          <LaunchChecklist title="Current setting" checks={ALL} />
        </UnitsProvider>
      </LocaleProvider>,
    );
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map(cells).slice(4)).toEqual([
      ["7.2 m/s", "≤ 10 m/s · limit"],
      ["610 m", "≤ 500 m · recommended"],
      ["18 km/h", "≤ 32 km/h · limit"],
      ["4°", "≤ 5° · limit"],
    ]);
  });
});
