import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { useLocale } from "@/components/i18n/LocaleProvider";
import { ApiError } from "@/lib/api";
import { ResultsDashboard } from "./ResultsDashboard";

// Route-owning component for "/results/[runId]". The actual page.tsx is an
// async Server Component (Next 16: dynamic params are awaited) — Vitest does
// not support rendering those (see vitest.config.ts) — so the smoke test
// targets ResultsDashboard directly with the runId it would have received.
const getResultMock = vi.fn().mockResolvedValue({
  run_id: "run-1",
  status: "done",
  result: {
    run_id: "run-1",
    scalars: { apogee_m: 1234.5, max_velocity_ms: 210.3 },
    plot_urls: [],
    warnings: [],
  },
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    getResult: (...args: Parameters<typeof actual.getResult>) => getResultMock(...args),
  };
});

// The interactive charts pull in three.js/echarts, which are heavy and
// irrelevant to a crash-on-mount smoke test of the dashboard shell — stub the
// dynamically-imported module out entirely.
vi.mock("@/components/results/InteractiveResults", () => ({
  InteractiveResults: () => null,
}));

/** Exposes a button that flips the active locale, from inside <LocaleProvider>. */
function LocaleSwitcher({ children }: { children: ReactNode }) {
  const { setLocale } = useLocale();
  return (
    <>
      <button onClick={() => setLocale("es")}>switch to es</button>
      {children}
    </>
  );
}

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

  it("re-localizes a fetch error when the language changes afterwards (issue #48)", async () => {
    getResultMock.mockRejectedValueOnce(
      new ApiError(500, "boom", { code: "requestFailed" }),
    );

    render(
      <AppProviders>
        <LocaleSwitcher>
          <ResultsDashboard runId="run-1" />
        </LocaleSwitcher>
      </AppProviders>,
    );

    // English error, derived from the query's error state at render time —
    // not captured in a stale closure.
    expect(await screen.findByText("The request failed (code 500).")).toBeInTheDocument();

    fireEvent.click(screen.getByText("switch to es"));

    // Same error, now in Spanish — proves the message isn't frozen from the
    // render that first caught the rejection.
    expect(await screen.findByText("La solicitud falló (código 500).")).toBeInTheDocument();
  });
});
