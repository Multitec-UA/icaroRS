import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import RootError from "./error";

// RootError is a plain synchronous Client Component (unlike the often-async
// page.tsx files), so it's safe for Vitest to render directly — see
// vitest.config.mts.
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

describe("RootError (app/error.tsx)", () => {
  it("renders the localized error message", async () => {
    render(
      <AppProviders>
        <RootError error={new Error("boom")} reset={vi.fn()} />
      </AppProviders>,
    );

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.getByText("An unexpected error occurred. You can try again."),
    ).toBeInTheDocument();
  });

  it("wires the recovery button to reset()", async () => {
    const reset = vi.fn();
    render(
      <AppProviders>
        <RootError error={new Error("boom")} reset={reset} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Try again" }));

    expect(reset).toHaveBeenCalledTimes(1);
  });
});
