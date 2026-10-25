import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { useWizard } from "@/components/wizard/WizardProvider";
import { RocketCard } from "./RocketCard";

const rocketSummary = {
  rocket_id: "rocket-1",
  name: "acme-1",
  created_at: "2026-01-01T00:00:00Z",
  created_by: "pilot@multitec.dev",
};

const exportSummary = (export_id: string, created_at: string) => ({
  export_id,
  rocket_id: "rocket-1",
  name: "acme-1",
  created_at,
  created_by: "pilot@multitec.dev",
  export_prefix: `exports/${export_id}/`,
  gcs_ref: `exports/${export_id}/`,
  ork_filename: `${export_id}.ork`,
  has_source_ork: true,
});

const getRocketMock = vi.fn();
const getExportMock = vi.fn();

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    getRocket: (...args: Parameters<typeof actual.getRocket>) => getRocketMock(...args),
    getExport: (...args: Parameters<typeof actual.getExport>) => getExportMock(...args),
  };
});

afterEach(() => {
  getRocketMock.mockReset();
  getExportMock.mockReset();
});

interface SeenState {
  exportId: string | null;
  rocketId: string | null;
  manifest: Record<string, unknown> | null;
  exportFilename: string | null;
  rocketName: string | null;
}

function WizardSpy({ onState }: { onState: (s: SeenState) => void }) {
  const { state } = useWizard();
  onState({
    exportId: state.exportId,
    rocketId: state.rocketId,
    manifest: state.manifest,
    exportFilename: state.exportFilename,
    rocketName: state.rocketName,
  });
  return null;
}

describe("RocketCard (issue #52 — client island in the server-rendered /rockets list)", () => {
  it("renders the rocket's own data", async () => {
    render(
      <AppProviders>
        <RocketCard rocket={rocketSummary} />
      </AppProviders>,
    );

    expect(await screen.findByText("acme-1")).toBeInTheDocument();
    expect(screen.getByText("pilot@multitec.dev")).toBeInTheDocument();
  });

  it("uses the rocket's newest export and navigates to the wizard on success", async () => {
    getRocketMock.mockResolvedValueOnce({
      ...rocketSummary,
      // Newest first, as the API returns them.
      exports: [exportSummary("export-new", "2026-02-01T00:00:00Z"), exportSummary("export-old", "2026-01-01T00:00:00Z")],
    });
    getExportMock.mockResolvedValueOnce({
      ...exportSummary("export-new", "2026-02-01T00:00:00Z"),
      manifest: { name: "acme-1 v2" },
    });
    const seen: SeenState[] = [];
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
        <RocketCard rocket={rocketSummary} />
        <WizardSpy onState={(s) => seen.push(s)} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Use this rocket"));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/"));
    expect(getRocketMock).toHaveBeenCalledWith("rocket-1");
    expect(getExportMock).toHaveBeenCalledWith("export-new");
    expect(seen.at(-1)).toEqual({
      exportId: "export-new",
      rocketId: "rocket-1",
      manifest: { name: "acme-1 v2" },
      // The Workbench's rocket context button reads these (S7).
      exportFilename: "export-new.ork",
      rocketName: "acme-1",
    });
  });

  it("shows the inline error when the rocket has no exports yet", async () => {
    getRocketMock.mockResolvedValueOnce({ ...rocketSummary, exports: [] });

    render(
      <AppProviders>
        <RocketCard rocket={rocketSummary} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Use this rocket"));

    expect(await screen.findByText("Could not use this rocket. Please try again.")).toBeInTheDocument();
    expect(getExportMock).not.toHaveBeenCalled();
  });

  it("shows an inline error when using a rocket fails, without a loading/catch gap", async () => {
    getRocketMock.mockRejectedValueOnce(
      new ApiError(500, "boom", { code: "requestFailed" }),
    );

    render(
      <AppProviders>
        <RocketCard rocket={rocketSummary} />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Use this rocket"));

    const error = await screen.findByText("Could not use this rocket. Please try again.");
    expect(error).toHaveAttribute("aria-live", "polite");
  });
});

describe("RocketCard — locale-aware, hydration-safe formatting", () => {
  it("formats the saved-on date with the app locale in UTC and never translates the author", async () => {
    render(
      <AppProviders>
        <RocketCard rocket={rocketSummary} />
      </AppProviders>,
    );

    expect(await screen.findByText("Jan 1, 2026")).toBeInTheDocument();
    expect(screen.getByText("pilot@multitec.dev")).toHaveAttribute("translate", "no");
  });
});
