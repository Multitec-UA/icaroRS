import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { RocketCard } from "./RocketCard";

const rocketSummary = {
  rocket_id: "rocket-1",
  name: "acme-1",
  created_at: "2026-01-01T00:00:00Z",
  created_by: "pilot@multitec.dev",
  export_prefix: "exports/rocket-1/",
  gcs_ref: "gs://bucket/rocket-1",
  ork_filename: "acme-1.ork",
  has_source_ork: true,
};

const getRocketMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    getRocket: (...args: Parameters<typeof actual.getRocket>) => getRocketMock(...args),
  };
});

afterEach(() => {
  getRocketMock.mockReset();
});

describe("RocketCard (issue #52 — client island in the server-rendered /rockets list)", () => {
  it("renders the rocket's own data", async () => {
    render(
      <AppProviders>
        <RocketCard rocket={rocketSummary} />
      </AppProviders>,
    );

    expect(await screen.findByText("acme-1")).toBeInTheDocument();
    expect(screen.getByText("pilot@multitec.dev")).toBeInTheDocument();
  });

  it("uses the rocket and navigates to the wizard on success", async () => {
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
        <RocketCard rocket={rocketSummary} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Use this rocket"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(getRocketMock).toHaveBeenCalledWith("rocket-1");
  });

  it("shows an inline error when using a rocket fails, without a loading/catch gap", async () => {
    getRocketMock.mockRejectedValueOnce(
      new ApiError(500, "boom", { code: "requestFailed" }),
    );

    render(
      <AppProviders>
        <RocketCard rocket={rocketSummary} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Use this rocket"));

    expect(
      await screen.findByText("Could not use this rocket. Please try again."),
    ).toBeInTheDocument();
  });
});
