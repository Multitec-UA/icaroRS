import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { RocketsList } from "./RocketsList";

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
    getRockets: vi.fn().mockResolvedValue([]),
  };
});

describe("RocketsList (route smoke test — /rockets)", () => {
  it("mounts without crashing and shows the heading", async () => {
    render(
      <AppProviders>
        <RocketsList />
      </AppProviders>,
    );

    expect(
      await screen.findByRole("heading", { name: "Your rockets" }),
    ).toBeInTheDocument();
  });
});
