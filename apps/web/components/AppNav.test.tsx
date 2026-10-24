import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { usePathname } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { useWizard } from "@/components/wizard/WizardProvider";

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
  it("renders nothing on / — the Workbench has its own sidebar", async () => {
    vi.mocked(usePathname).mockReturnValue("/");
    render(<AppProviders>content</AppProviders>);

    expect(await screen.findByText("content")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Primary navigation" })).toBeNull();
  });

  it("renders the primary destinations as links with their hrefs on /rockets", async () => {
    vi.mocked(usePathname).mockReturnValue("/rockets");
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

  describe("leaving /results", () => {
    function ExportProbe() {
      const { state, setExport } = useWizard();
      useEffect(() => {
        setExport("export-1", {});
      }, [setExport]);
      return <span data-testid="export-id">{state.exportId ?? ""}</span>;
    }

    async function renderOnResults() {
      vi.mocked(usePathname).mockReturnValue("/results/run-1");
      render(
        <AppProviders>
          <ExportProbe />
        </AppProviders>,
      );
      await waitFor(() => expect(screen.getByTestId("export-id")).toHaveTextContent("export-1"));
      return screen.getByRole("link", { name: "Simulate" });
    }

    it("resets the wizard draft on a plain click", async () => {
      const link = await renderOnResults();

      fireEvent.click(link);

      expect(screen.getByTestId("export-id")).toHaveTextContent("");
    });

    it("keeps the wizard draft on a modified click (new tab stays a navigation only)", async () => {
      const link = await renderOnResults();

      fireEvent.click(link, { metaKey: true });
      fireEvent.click(link, { ctrlKey: true });
      fireEvent.click(link, { button: 1 });

      expect(screen.getByTestId("export-id")).toHaveTextContent("export-1");
    });
  });
});
