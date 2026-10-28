import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { HistoryCard } from "./HistoryCard";

const historyItem = {
  simulation_id: "sim-1",
  rocket_id: "rocket-1",
  name: "acme-1",
  created_at: "2026-01-01T00:00:00Z",
  created_by: "pilot@multitec.dev",
  status: "done" as const,
  scalars: { apogee: 1000 },
  scenario: { name: "acme-1" },
  warnings: [],
  result_prefix: "results/sim-1/",
  plot_names: [],
  has_series: false,
};

const simulateMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    simulate: (...args: Parameters<typeof actual.simulate>) => simulateMock(...args),
  };
});

// The global motion stub never ticks `animate`, so CountUp would sit at 0
// forever; render its settled value so the card's own formatter is observable.
vi.mock("@/components/motion", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/motion")>();
  return {
    ...actual,
    CountUp: ({ value, format }: { value: number; format: (n: number) => string }) => (
      <span>{format(value)}</span>
    ),
  };
});

afterEach(() => {
  simulateMock.mockReset();
});

describe("HistoryCard (issue #52 — client island in the server-rendered /history list)", () => {
  it("renders the entry's own data", async () => {
    render(
      <AppProviders>
        <HistoryCard item={historyItem} />
      </AppProviders>,
    );

    expect(await screen.findByText("acme-1")).toBeInTheDocument();
  });

  it("re-runs an entry and navigates to the new result (issue #48 mutation)", async () => {
    simulateMock.mockResolvedValueOnce({
      run_id: "run-2",
      scalars: {},
      plot_urls: [],
      warnings: [],
    });
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
      bfcacheId: "test",
    });

    render(
      <AppProviders>
        <HistoryCard item={historyItem} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Re-run"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/results/run-2"));
    expect(simulateMock).toHaveBeenCalledWith("rocket-1", historyItem.scenario);
  });

  it("shows an inline error when re-running fails", async () => {
    simulateMock.mockRejectedValueOnce(
      new ApiError(500, "boom", { code: "requestFailed" }),
    );

    render(
      <AppProviders>
        <HistoryCard item={historyItem} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Re-run"));

    const error = await screen.findByText("The request failed (code 500).");
    expect(error).toHaveAttribute("aria-live", "polite");
  });
});

describe("HistoryCard — locale-aware, hydration-safe formatting", () => {
  it("formats the date with the app locale in UTC and the apogee with Intl grouping", async () => {
    render(
      <AppProviders>
        <HistoryCard item={historyItem} />
      </AppProviders>,
    );

    // en + UTC: the server and every client render the same string, whatever
    // the browser's own zone is.
    expect(await screen.findByText("Jan 1, 2026, 12:00 AM")).toBeInTheDocument();
    expect(screen.getByText("1,000")).toBeInTheDocument();
  });

  it("explains why Re-run is unavailable on a failed entry", async () => {
    render(
      <AppProviders>
        <HistoryCard item={{ ...historyItem, status: "error" }} />
      </AppProviders>,
    );

    const button = await screen.findByRole("button", { name: /Re-run/ });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Re-run is unavailable for failed runs.");
    expect(button).toHaveTextContent("Re-run is unavailable for failed runs.");
  });
});

describe("HistoryCard — view stored results without re-running", () => {
  it("links a finished entry to its stored results page", async () => {
    render(
      <AppProviders>
        <HistoryCard item={historyItem} />
      </AppProviders>,
    );

    const link = await screen.findByRole("link", { name: /View details/ });
    expect(link).toHaveAttribute("href", "/results/sim-1");
    expect(simulateMock).not.toHaveBeenCalled();
  });

  it("offers no details link for a failed entry, which has no stored results", async () => {
    render(
      <AppProviders>
        <HistoryCard item={{ ...historyItem, status: "error" }} />
      </AppProviders>,
    );

    expect(await screen.findByText("acme-1")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /View details/ })).not.toBeInTheDocument();
  });
});
