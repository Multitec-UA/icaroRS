import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { RocketsList } from "./RocketsList";

const rocketSummary = {
  rocket_id: "rocket-1",
  name: "acme-1",
  created_at: "2026-01-01T00:00:00Z",
  created_by: "pilot@multitec.dev",
};

const getRocketsMock = vi.fn().mockResolvedValue([rocketSummary]);
const getRocketMock = vi.fn();

// Route-owning component for "/rockets" (app/rockets/page.tsx renders this
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
    getRockets: (...args: Parameters<typeof actual.getRockets>) => getRocketsMock(...args),
    getRocket: (...args: Parameters<typeof actual.getRocket>) => getRocketMock(...args),
  };
});

afterEach(() => {
  getRocketMock.mockReset();
});

describe("RocketsList (route smoke test — /rockets)", () => {
  it("mounts without crashing and shows the heading", async () => {
    getRocketsMock.mockResolvedValueOnce([]);
    render(
      <AppProviders>
        <RocketsList />
      </AppProviders>,
    );

    expect(
      await screen.findByRole("heading", { name: "Your rockets" }),
    ).toBeInTheDocument();
  });

  it("uses a rocket and navigates to the wizard on success", async () => {
    getRocketMock.mockResolvedValueOnce({
      ...rocketSummary,
      manifest: { name: "acme-1" },
      gcs_ref: "gs://bucket/rocket-1",
    });
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    });

    render(
      <AppProviders>
        <RocketsList />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Use this rocket"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(getRocketMock).toHaveBeenCalledWith("rocket-1");
  });

  it("shows an inline error when using a rocket fails (issue #50 — was silently a no-op)", async () => {
    getRocketMock.mockRejectedValueOnce(
      new ApiError(500, "boom", { code: "requestFailed" }),
    );

    render(
      <AppProviders>
        <RocketsList />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Use this rocket"));

    expect(
      await screen.findByText("Could not use this rocket. Please try again."),
    ).toBeInTheDocument();
  });
});
