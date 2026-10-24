import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { AppProviders } from "@/test/test-providers";

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

/**
 * Web Interface Guidelines: navigation uses real links so Cmd/Ctrl-click,
 * middle-click and "open in new tab" work. AppNav is rendered by AuthGate
 * once the identity resolves, hence the full provider stack.
 */
describe("AppNav", () => {
  it("renders the primary destinations as links with their hrefs", async () => {
    render(<AppProviders>content</AppProviders>);

    const nav = await screen.findByRole("navigation", { name: "Primary navigation" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));

    expect(links).toEqual(["/", "/rockets", "/history"]);
    expect(nav.querySelector("button")).toBeNull();
  });

  it("marks the active destination with aria-current=page", async () => {
    vi.mocked(usePathname).mockReturnValue("/history/");
    render(<AppProviders>content</AppProviders>);

    const active = await screen.findByRole("link", { name: "History" });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Simulate" })).not.toHaveAttribute("aria-current");
  });
});
