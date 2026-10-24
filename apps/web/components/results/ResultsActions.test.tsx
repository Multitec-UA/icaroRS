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
  it("'Simulate again' is a real link to / that also sends the wizard to the basics step", async () => {
    let capturedStep: string | undefined;
    function StepProbe() {
      const { step } = useWizard();
      capturedStep = step;
      return null;
    }

    render(
      <AppProviders>
        <StepProbe />
        <ResultsActions />
      </AppProviders>,
    );

    // A navigation is a link (Cmd/Ctrl-click, middle-click, "open in new tab"
    // all keep working), not a button that pushes the router.
    const link = await screen.findByRole("link", { name: "Simulate again" });
    expect(link).toHaveAttribute("href", "/");

    fireEvent.click(link);

    expect(capturedStep).toBe("basics");
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
        <ResultsActions />
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
        <ResultsActions />
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
