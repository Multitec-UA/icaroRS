import { useEffect } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { useWizard } from "@/components/wizard/WizardProvider";
import { ResultsActions } from "./ResultsActions";

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

describe("ResultsActions (issue #52 — client island)", () => {
  it("'Open in Workbench' is a real link to the run's Workbench URL (S8)", async () => {
    render(
      <AppProviders>
        <ResultsActions runId="run-42" />
      </AppProviders>,
    );

    // A navigation is a link (Cmd/Ctrl-click, middle-click, "open in new tab"
    // all keep working); the Workbench loads the run from its URL.
    const link = await screen.findByRole("link", { name: "Open in Workbench" });
    expect(link).toHaveAttribute("href", "/?run=run-42");
    expect(screen.queryByRole("link", { name: "Simulate again" })).toBeNull();
  });

  it("'Download PDF' prints the report, which the print rules turn into the PDF (S13)", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(
      <AppProviders>
        <ResultsActions runId="run-1" />
      </AppProviders>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Download PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
    print.mockRestore();
  });

  it("'New rocket' resets the wizard and navigates to /", async () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
      bfcacheId: "test",
    });

    let capturedExportId: string | null | undefined;
    function ExportProbe() {
      const { state, setExport } = useWizard();
      capturedExportId = state.exportId;
      useEffect(() => {
        setExport("export-1", {});
      }, [setExport]);
      return <span data-testid="export-id">{state.exportId ?? ""}</span>;
    }

    render(
      <AppProviders>
        <ExportProbe />
        <ResultsActions runId="run-42" />
      </AppProviders>,
    );

    // Wait for the seeding effect to land before asserting reset() actually
    // changed anything (otherwise exportId is null both before and after).
    await waitFor(() => expect(screen.getByTestId("export-id")).toHaveTextContent("export-1"));

    // Destructive: the first click only asks; nothing is discarded yet.
    fireEvent.click(screen.getByRole("button", { name: "New rocket" }));

    expect(screen.getByRole("status")).toHaveTextContent(
      "Discard this draft and start a new rocket?",
    );
    expect(capturedExportId).toBe("export-1");
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    expect(capturedExportId).toBeNull();
    expect(push).toHaveBeenCalledWith("/");
  });

  it("'New rocket' can be cancelled without losing the draft", async () => {
    let capturedExportId: string | null | undefined;
    function ExportProbe() {
      const { state, setExport } = useWizard();
      capturedExportId = state.exportId;
      useEffect(() => {
        setExport("export-1", {});
      }, [setExport]);
      return <span data-testid="export-id">{state.exportId ?? ""}</span>;
    }

    render(
      <AppProviders>
        <ExportProbe />
        <ResultsActions runId="run-42" />
      </AppProviders>,
    );
    await waitFor(() => expect(screen.getByTestId("export-id")).toHaveTextContent("export-1"));

    fireEvent.click(screen.getByRole("button", { name: "New rocket" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(capturedExportId).toBe("export-1");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "New rocket" })).toBeInTheDocument();
  });
});
