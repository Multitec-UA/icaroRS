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
  it("'Simulate again' sends the wizard to the basics step and navigates to /", async () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push,
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
    });

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

    fireEvent.click(await screen.findByText("Simulate again"));

    expect(capturedStep).toBe("basics");
    expect(push).toHaveBeenCalledWith("/");
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

    fireEvent.click(screen.getByText("New rocket"));

    expect(capturedExportId).toBeNull();
    expect(push).toHaveBeenCalledWith("/");
  });
});
