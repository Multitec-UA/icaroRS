import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
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
