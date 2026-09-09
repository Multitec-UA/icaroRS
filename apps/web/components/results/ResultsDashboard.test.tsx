import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { ResultsDashboard } from "./ResultsDashboard";

// Route-owning component for "/results/[runId]". The actual page.tsx is an
// async Server Component (Next 16: dynamic params are awaited) — Vitest does
// not support rendering those (see vitest.config.ts) — so the smoke test
// targets ResultsDashboard directly with the runId it would have received.
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    getResult: vi.fn().mockResolvedValue({
      run_id: "run-1",
      status: "done",
      result: {
        run_id: "run-1",
        scalars: { apogee_m: 1234.5, max_velocity_ms: 210.3 },
        plot_urls: [],
        warnings: [],
      },
    }),
  };
});

// The interactive charts pull in three.js/echarts, which are heavy and
// irrelevant to a crash-on-mount smoke test of the dashboard shell — stub the
// dynamically-imported module out entirely.
vi.mock("@/components/results/InteractiveResults", () => ({
  InteractiveResults: () => null,
}));

describe("ResultsDashboard (route smoke test — /results/[runId])", () => {
  it("mounts without crashing and shows the fetched result", async () => {
    render(
      <AppProviders>
        <ResultsDashboard runId="run-1" />
      </AppProviders>,
    );

    expect(
      await screen.findByRole("heading", { name: "Flight results" }),
    ).toBeInTheDocument();
  });
});
