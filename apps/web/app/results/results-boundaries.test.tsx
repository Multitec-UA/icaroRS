import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
// Imported by relative path rather than colocated as `[runId]/*.test.tsx`:
// Vitest's default test-file glob treats `[...]` as a character class, so a
// test file living inside the `[runId]` directory itself would silently
// never be discovered. Importing the real route files from here avoids that
// pitfall while still exercising the actual boundary files Next.js loads.
import ResultsError from "./[runId]/error";
import ResultsLoading from "./[runId]/loading";

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

describe("ResultsError (app/results/[runId]/error.tsx)", () => {
  it("renders the localized error message", async () => {
    render(
      <AppProviders>
        <ResultsError error={new Error("boom")} reset={vi.fn()} />
      </AppProviders>,
    );

    expect(
      await screen.findByText("We couldn't display this flight's results."),
    ).toBeInTheDocument();
  });

  it("wires the recovery button to reset()", async () => {
    const reset = vi.fn();
    render(
      <AppProviders>
        <ResultsError error={new Error("boom")} reset={reset} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("offers the way back to the start as a real link", async () => {
    render(
      <AppProviders>
        <ResultsError error={new Error("boom")} reset={vi.fn()} />
      </AppProviders>,
    );

    // A link (not a button calling router.push) so Cmd/Ctrl-click and
    // middle-click open the start page in a new tab.
    expect(await screen.findByRole("link", { name: "← Back to start" })).toHaveAttribute(
      "href",
      "/",
    );
  });
});

describe("ResultsLoading (app/results/[runId]/loading.tsx)", () => {
  it("renders the localized loading message", async () => {
    render(
      <AppProviders>
        <ResultsLoading />
      </AppProviders>,
    );

    expect(await screen.findByText("Loading results…")).toBeInTheDocument();
  });
});
