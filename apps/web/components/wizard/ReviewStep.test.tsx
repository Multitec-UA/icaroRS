import { useEffect, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { mockBrowserTimeZone } from "@/test/mock-time-zone";
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
      bfcacheId: "test",
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

describe("ReviewStep — launch time in the user's time zone", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function WithLaunchTime({ children }: { children: ReactNode }) {
    const { setExport, setLaunchDatetime, state } = useWizard();
    useEffect(() => {
      setExport("export-1", { name: "acme-1" });
      setLaunchDatetime("2026-10-24T10:00");
    }, [setExport, setLaunchDatetime]);
    return (
      <>
        <span data-testid="export-id">{state.exportId ?? ""}</span>
        {children}
      </>
    );
  }

  it("shows the chosen local time and sends its UTC hour to the API", async () => {
    mockBrowserTimeZone("Europe/Madrid");
    simulateMock.mockResolvedValueOnce({ run_id: "run-1", scalars: {}, plot_urls: [], warnings: [] });
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
      prefetch: vi.fn(),
      bfcacheId: "test",
    });

    render(
      <AppProviders>
        <WithLaunchTime>
          <ReviewStep />
        </WithLaunchTime>
      </AppProviders>,
    );

    await waitForExportSeeded();
    const row = screen.getByText("Launch time").parentElement as HTMLElement;
    expect(row).toHaveTextContent("10:00");
    expect(row).not.toHaveTextContent("UTC");

    fireEvent.click(screen.getByText("Run simulation 🚀"));
    await waitFor(() => expect(simulateMock).toHaveBeenCalled());
    expect(simulateMock.mock.calls[0][1].date).toEqual({
      year: 2026,
      month: 10,
      day: 24,
      hour: 8,
    });
  });
});

describe("ReviewStep — locale-aware numbers", () => {
  function WithSite({ children }: { children: ReactNode }) {
    const { setExport, setSite, state } = useWizard();
    useEffect(() => {
      setExport("export-1", { name: "acme-1" });
      setSite({ latitude: 38.3452, longitude: -0.4815, elevation: 1234.4 });
    }, [setExport, setSite]);
    return (
      <>
        <span data-testid="export-id">{state.exportId ?? ""}</span>
        {children}
      </>
    );
  }

  it("formats the site through Intl.NumberFormat with a non-breaking space before the unit", async () => {
    render(
      <AppProviders>
        <WithSite>
          <ReviewStep />
        </WithSite>
      </AppProviders>,
    );

    await waitForExportSeeded();
    // Exact textContent: the default text matcher folds the non-breaking
    // space into a plain one, which is precisely what this pins down.
    const value = screen.getByText("Site").nextElementSibling;
    expect(value?.textContent).toBe("38.3452, -0.4815 · 1,234.4 m");
  });
});
