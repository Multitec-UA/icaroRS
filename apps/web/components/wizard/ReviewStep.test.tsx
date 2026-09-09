import { useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { useWizard } from "./WizardProvider";
import { ReviewStep } from "./ReviewStep";

const { simulateMock } = vi.hoisted(() => ({ simulateMock: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    simulate: (...args: Parameters<typeof actual.simulate>) => simulateMock(...args),
  };
});

/**
 * Seeds the wizard with an exportId so ReviewStep.run() doesn't bail out.
 * Renders a marker with the current exportId so tests can explicitly wait
 * for the effect to have landed before clicking — the effect fires after
 * AuthGate resolves its own async identity check, so racing it based on
 * "the button is on screen" alone is not reliable.
 */
function WithExport({ children }: { children: ReactNode }) {
  const { setExport, state } = useWizard();
  useEffect(() => {
    setExport("export-1", { name: "acme-1" });
  }, [setExport]);
  return (
    <>
      <span data-testid="export-id">{state.exportId ?? ""}</span>
      {children}
    </>
  );
}

async function waitForExportSeeded() {
  await waitFor(() => expect(screen.getByTestId("export-id")).toHaveTextContent("export-1"));
}

afterEach(() => {
  simulateMock.mockReset();
});

describe("ReviewStep (issue #48 — shared simulate mutation)", () => {
  it("runs the simulation and navigates to the new result on success", async () => {
    simulateMock.mockResolvedValueOnce({
      run_id: "run-9",
      scalars: {},
      plot_urls: [],
      warnings: [],
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
        <WithExport>
          <ReviewStep />
        </WithExport>
      </AppProviders>,
    );

    await waitForExportSeeded();
    fireEvent.click(screen.getByText("Run simulation 🚀"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/results/run-9"));
  });

  it("shows field errors from a 422 without navigating", async () => {
    simulateMock.mockRejectedValueOnce(
      new ApiError(422, "invalid", {
        code: "validation",
        fieldErrors: [{ loc: ["site"], field: "site", message: "Site is required" }],
      }),
    );

    render(
      <AppProviders>
        <WithExport>
          <ReviewStep />
        </WithExport>
      </AppProviders>,
    );

    await waitForExportSeeded();
    fireEvent.click(screen.getByText("Run simulation 🚀"));

    expect(await screen.findByText(/Site is required/)).toBeInTheDocument();
  });
});
