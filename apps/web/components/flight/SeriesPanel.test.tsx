import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { SeriesPanel } from "./SeriesPanel";
import { SERIES } from "./fixtures";

// echarts draws on a <canvas> jsdom does not provide; the panel's contract
// (tabs, title, the chart's accessible name) lives in the DOM around it.
vi.mock("echarts", () => ({
  init: () => ({ setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }),
  graphic: { LinearGradient: class {} },
}));

beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

async function renderPanel() {
  const view = render(
    <LocaleProvider initialLocale="en">
      <SeriesPanel series={SERIES} />
    </LocaleProvider>,
  );
  await screen.findByRole("img", { name: "Altitude over time, peak 300" });
  return view;
}

describe("SeriesPanel — metric tabs around the series chart", () => {
  it("offers one tab per available metric and selects altitude first", async () => {
    await renderPanel();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["Altitude", "Speed", "Mach", "Acceleration"]);
    expect(screen.getByRole("tab", { name: "Altitude" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Altitude" })).toBeInTheDocument();
  });

  it("switches the chart's metric from the tabs", async () => {
    await renderPanel();

    fireEvent.click(screen.getByRole("tab", { name: "Speed" }));

    expect(screen.getByRole("tab", { name: "Speed" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Altitude" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("heading", { name: "Speed" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Speed over time, peak 50" })).toBeInTheDocument();
    // The chart does not render a second set of toggles under the tabs.
    expect(screen.queryByRole("button", { name: "Speed" })).toBeNull();
  });

  it("only offers the metrics the series actually carries", () => {
    render(
      <LocaleProvider initialLocale="en">
        <SeriesPanel series={{ t: [0, 1], altitude: [0, 10] }} />
      </LocaleProvider>,
    );
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Altitude"]);
  });
});
