import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { makeT } from "@/lib/i18n";
import { ResultsContentServer } from "./ResultsContentServer";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
  };
});

vi.mock("@/lib/server-api", () => ({
  getResultServer: vi.fn().mockResolvedValue({
    result: {
      scalars: { apogee_m: 1234.5, apogee_time_s: 12.3 },
      warnings: [],
      plot_urls: [],
    },
  }),
}));

// The interactive section is a `ssr:false` dynamic import of three/echarts —
// out of scope for the server-rendered markup under test here.
vi.mock("./InteractiveResultsLazy", () => ({
  InteractiveResultsLazy: () => <div>interactive-stub</div>,
}));

// Vitest cannot render an async Server Component directly (see
// vitest.config.ts); awaiting it yields the plain element tree, whose client
// islands then render under the usual provider stack.
async function renderResults() {
  // LocaleProvider registers the catalogs on import; AppProviders pulls it in.
  const tree = await ResultsContentServer({ runId: "run-1", t: makeT("en"), locale: "en" });
  return render(<AppProviders>{tree}</AppProviders>);
}

describe("ResultsContentServer — server-rendered results markup", () => {
  it("keeps the run id out of machine translation", async () => {
    await renderResults();

    const runId = await screen.findByText("run-1");
    expect(runId).toHaveAttribute("translate", "no");
    expect(runId.closest("p")).toHaveTextContent("Run run-1");
  });

  it("gives the summary table a caption and row headers", async () => {
    await renderResults();

    const table = await screen.findByRole("table", { name: "Run summary" });
    expect(table).toBeInTheDocument();
    const rowHeader = screen.getByRole("rowheader", { name: "Time to apogee" });
    expect(rowHeader).toHaveAttribute("scope", "row");
  });
});
