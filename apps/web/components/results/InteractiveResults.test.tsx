import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { InteractiveResults } from "./InteractiveResults";

const getSeriesMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getSeries: (...args: Parameters<typeof actual.getSeries>) => getSeriesMock(...args),
  };
});

// The real charts pull in three.js/echarts, which need a canvas jsdom doesn't
// provide — irrelevant to this component's own fetch/render-branch logic, so
// they're stubbed out the same way ResultsDashboard.test.tsx stubs this
// module out entirely.
vi.mock("@/components/charts/SeriesChart", () => ({
  SeriesChart: () => <div>series-chart-stub</div>,
}));
vi.mock("@/components/charts/Trajectory3D", () => ({
  Trajectory3D: () => <div>trajectory-3d-stub</div>,
}));

// InteractiveResults only needs the query + locale layers (no auth/wizard
// concerns), unlike the full-route smoke tests.
function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <LocaleProvider initialLocale="en">{children}</LocaleProvider>
    </QueryClientProvider>
  );
}

describe("InteractiveResults (issue #48 — server-state layer)", () => {
  it("renders nothing once the series 404s (a run predating the feature)", async () => {
    getSeriesMock.mockRejectedValueOnce(new Error("404"));

    const { container } = render(
      <Providers>
        <InteractiveResults runId="run-old" />
      </Providers>,
    );

    await vi.waitFor(() => expect(getSeriesMock).toHaveBeenCalledWith("run-old"));
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("renders the telemetry section once the series resolves", async () => {
    getSeriesMock.mockResolvedValueOnce({ t: [0, 1, 2], altitude: [0, 10, 20] });

    render(
      <Providers>
        <InteractiveResults runId="run-1" />
      </Providers>,
    );

    expect(await screen.findByText("Telemetry")).toBeInTheDocument();
  });
});
