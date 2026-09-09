import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { HistoryList } from "./HistoryList";

// Route-owning component for "/history" (app/history/page.tsx renders this
// directly with no props).
vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    getHistory: vi.fn().mockResolvedValue([]),
  };
});

describe("HistoryList (route smoke test — /history)", () => {
  it("mounts without crashing and shows the heading", async () => {
    render(
      <AppProviders>
        <HistoryList />
      </AppProviders>,
    );

    expect(
      await screen.findByRole("heading", { name: "Flight history" }),
    ).toBeInTheDocument();
  });
});
