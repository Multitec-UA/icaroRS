import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { Sidebar } from "./Sidebar";

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

// The provider stack (AuthGate → AppShell) already mounts one Sidebar for
// every route, so the queries are scoped to the Sidebar rendered here.
async function renderSidebar() {
  render(
    <AppProviders>
      <div data-testid="sidebar">
        <Sidebar />
      </div>
    </AppProviders>,
  );
  return within(await screen.findByTestId("sidebar"));
}

describe("Sidebar (S7)", () => {
  it("renders Workbench, Rockets and Runs as real links, marking the active one", async () => {
    vi.mocked(usePathname).mockReturnValue("/rockets");
    const sidebar = await renderSidebar();

    const nav = await sidebar.findByRole("navigation", { name: "Primary navigation" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/", "/rockets", "/runs"]);

    expect(sidebar.getByRole("link", { name: "Rockets" })).toHaveAttribute("aria-current", "page");
    expect(sidebar.getByRole("link", { name: "Workbench" })).not.toHaveAttribute("aria-current");
    expect(sidebar.getByRole("link", { name: "Runs" })).not.toHaveAttribute("aria-current");
  });

  it("marks Workbench active on / and exposes the theme toggle and account menu", async () => {
    vi.mocked(usePathname).mockReturnValue("/");
    const sidebar = await renderSidebar();

    expect(await sidebar.findByRole("link", { name: "Workbench" })).toHaveAttribute("aria-current", "page");
    expect(sidebar.getByRole("button", { name: /Switch to (dark|light) mode/ })).toBeInTheDocument();
    expect(sidebar.getByRole("button", { name: "Account" })).toBeInTheDocument();
  });
});
