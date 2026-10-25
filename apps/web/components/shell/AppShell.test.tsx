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
    getIdentity: vi.fn().mockResolvedValue({ user_id: "u1", org_id: "o1", email: "pilot@multitec.dev" }),
  };
});

/**
 * One navigation for every authenticated route (S9/T8b): AuthGate renders
 * the sidebar around <main id="main"> whatever the pathname, so /rockets,
 * /runs and /results/* share the Workbench's own nav instead of AppNav.
 */
describe("AppShell — the sidebar on every authenticated route", () => {
  it.each(["/rockets", "/results/run-1", "/runs"])("renders the primary navigation on %s", async (pathname) => {
    vi.mocked(usePathname).mockReturnValue(pathname);
    render(<AppProviders>content</AppProviders>);

    const nav = await screen.findByRole("navigation", { name: "Primary navigation" });
    const links = Array.from(nav.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(links).toEqual(["/", "/rockets", "/runs"]);
    expect(screen.getByText("content").closest("main")).toHaveAttribute("id", "main");
  });

  it("keeps the skip link first and pointing at the main landmark", async () => {
    vi.mocked(usePathname).mockReturnValue("/rockets");
    render(<AppProviders>content</AppProviders>);

    const skip = await screen.findByRole("link", { name: "Skip to main content" });
    expect(skip).toHaveAttribute("href", "#main");
    expect(skip.compareDocumentPosition(screen.getByRole("navigation", { name: "Primary navigation" })))
      .toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("marks the active destination with aria-current=page", async () => {
    vi.mocked(usePathname).mockReturnValue("/runs/");
    render(<AppProviders>content</AppProviders>);

    expect(await screen.findByRole("link", { name: "Runs" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Workbench" })).not.toHaveAttribute("aria-current");
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
      return screen.getByRole("link", { name: "Workbench" });
    }

    it("resets the wizard draft on a plain click", async () => {
      const link = await renderOnResults();

      fireEvent.click(link);

      expect(screen.getByTestId("export-id")).toHaveTextContent("");
    });

    it("keeps the draft on a modified click (a new tab is a navigation only)", async () => {
      const link = await renderOnResults();

      fireEvent.click(link, { metaKey: true });
      fireEvent.click(link, { ctrlKey: true });
      fireEvent.click(link, { button: 1 });

      expect(screen.getByTestId("export-id")).toHaveTextContent("export-1");
    });
  });
});
