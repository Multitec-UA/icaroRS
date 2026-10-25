import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { makeT } from "@/lib/i18n";
import { RocketsListServer } from "./RocketsListServer";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
  };
});

vi.mock("@/lib/server-api", () => ({
  getRocketsServer: vi.fn().mockResolvedValue([
    { rocket_id: "r1", name: "Icarus-1", created_at: "2026-01-01T00:00:00Z", created_by: "pilot@multitec.dev" },
    { rocket_id: "r2", name: "Icarus-2", created_at: "2026-02-01T00:00:00Z", created_by: "ana@multitec.dev" },
  ]),
}));

describe("/rockets list (S9: on the theme tokens)", () => {
  it("renders every rocket with its author and date, and a way to use it", async () => {
    const tree = await RocketsListServer({ t: makeT("en") });
    render(<AppProviders>{tree}</AppProviders>);

    expect(await screen.findByText("Icarus-1")).toBeInTheDocument();
    expect(screen.getByText("Icarus-2")).toBeInTheDocument();
    expect(screen.getByText("ana@multitec.dev")).toHaveAttribute("translate", "no");
    expect(screen.getByText("Feb 1, 2026")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use this rocket" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Runs" }).some((a) => a.getAttribute("href") === "/runs?rocket_id=r2")).toBe(true);
  });
});
