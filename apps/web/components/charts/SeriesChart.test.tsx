import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { SeriesChart } from "./SeriesChart";

// echarts draws on a <canvas>, which jsdom does not provide. The chart's
// accessible contract (toggle state, accessible name, localized labels)
// lives in the DOM around it, so the library is replaced with an inert
// instance that records the option it was given.
const { setOption } = vi.hoisted(() => ({ setOption: vi.fn() }));

vi.mock("echarts", () => ({
  init: () => ({ setOption, resize: vi.fn(), dispose: vi.fn() }),
  graphic: { LinearGradient: class {} },
}));

beforeAll(() => {
  // jsdom has no ResizeObserver; the chart only uses it to call resize().
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
});

const series = { t: [0, 1, 2], altitude: [0, 10, 20], speed: [0, 5.5, 3] };

function renderChart(locale: "en" | "es" = "en") {
  return render(
    <LocaleProvider initialLocale={locale}>
      <SeriesChart series={series} />
    </LocaleProvider>,
  );
}

describe("SeriesChart — accessible metric toggles and chart name", () => {
  it("marks the active metric with aria-pressed and names the canvas after it", () => {
    renderChart();

    const altitude = screen.getByRole("button", { name: "Altitude", pressed: true });
    const speed = screen.getByRole("button", { name: "Speed", pressed: false });
    expect(altitude).toBeInTheDocument();
    expect(speed).toBeInTheDocument();

    expect(screen.getByRole("img", { name: "Altitude over time, peak 20" })).toBeInTheDocument();

    fireEvent.click(speed);

    expect(screen.getByRole("button", { name: "Speed", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Speed over time, peak 5.5" })).toBeInTheDocument();
  });

  it("localizes the metric labels and the time axis", () => {
    renderChart("es");

    expect(screen.getByRole("button", { name: "Altitud" })).toBeInTheDocument();
    const lastOption = setOption.mock.calls.at(-1)?.[0] as { xAxis: { name: string } };
    expect(lastOption.xAxis.name).toBe("Tiempo (s)");
  });
});

describe("SeriesChart — controlled metric (flight series panel)", () => {
  it("owns the active metric and renders its own toggles when uncontrolled", () => {
    renderChart();

    expect(screen.getAllByRole("button")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Speed" }));
    expect(screen.getByRole("img", { name: "Speed over time, peak 5.5" })).toBeInTheDocument();
  });

  it("follows the controlled metric and leaves the toggles to the controller", () => {
    const onMetricChange = vi.fn();
    const { rerender } = render(
      <LocaleProvider initialLocale="en">
        <SeriesChart series={series} metric="speed" onMetricChange={onMetricChange} />
      </LocaleProvider>,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("img", { name: "Speed over time, peak 5.5" })).toBeInTheDocument();

    rerender(
      <LocaleProvider initialLocale="en">
        <SeriesChart series={series} metric="altitude" onMetricChange={onMetricChange} />
      </LocaleProvider>,
    );
    expect(screen.getByRole("img", { name: "Altitude over time, peak 20" })).toBeInTheDocument();
  });

  it("paints the chart with the palette it is given", () => {
    setOption.mockClear();
    render(
      <LocaleProvider initialLocale="en">
        <SeriesChart
          series={series}
          palette={{ altitude: "#abcdef", ink: "#111111", muted: "#222222", divider: "#333333", axis: "#444444", surface: "#555555", border: "#666666" }}
        />
      </LocaleProvider>,
    );

    const option = setOption.mock.calls.at(-1)?.[0] as {
      series: { lineStyle: { color: string } }[];
      xAxis: { axisLabel: { color: string } };
    };
    expect(option.series[0].lineStyle.color).toBe("#abcdef");
    expect(option.xAxis.axisLabel.color).toBe("#222222");
  });
});
