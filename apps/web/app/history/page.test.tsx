import { describe, expect, it, vi } from "vitest";
import HistoryPage from "./page";

const { redirectMock } = vi.hoisted(() => ({ redirectMock: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("/history → /runs (S9: /runs replaces /history)", () => {
  it("redirects to /runs, keeping the rocket filter", async () => {
    await HistoryPage({ searchParams: Promise.resolve({ rocket_id: "r2" }) });

    expect(redirectMock).toHaveBeenCalledWith("/runs?rocket_id=r2");
  });

  it("redirects to a bare /runs when there is no query", async () => {
    await HistoryPage({ searchParams: Promise.resolve({}) });

    expect(redirectMock).toHaveBeenCalledWith("/runs");
  });

  it("keeps repeated parameters", async () => {
    await HistoryPage({ searchParams: Promise.resolve({ rocket_id: "r2", tag: ["a", "b"] }) });

    expect(redirectMock).toHaveBeenCalledWith("/runs?rocket_id=r2&tag=a&tag=b");
  });
});
