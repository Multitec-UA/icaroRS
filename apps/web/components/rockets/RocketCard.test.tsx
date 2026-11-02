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
const renameRocketMock = vi.fn();

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
    renameRocket: (...args: Parameters<typeof actual.renameRocket>) => renameRocketMock(...args),
  };
});

afterEach(() => {
  getRocketMock.mockReset();
  getExportMock.mockReset();
  renameRocketMock.mockReset();
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

  it("opens the rocket's newest file in the Workbench through its URL, without touching the draft (S8)", async () => {
    getRocketMock.mockResolvedValueOnce({
      ...rocketSummary,
      // Newest first, as the API returns them.
      exports: [exportSummary("export-new", "2026-02-01T00:00:00Z"), exportSummary("export-old", "2026-01-01T00:00:00Z")],
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

    await waitFor(() => expect(push).toHaveBeenCalledWith("/?file=export-new"));
    expect(getRocketMock).toHaveBeenCalledWith("rocket-1");
    // The Workbench loads the file from its URL; the card leaves the draft alone.
    expect(getExportMock).not.toHaveBeenCalled();
    expect(seen.at(-1)?.exportId).toBeNull();
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

describe("RocketCard — rename", () => {
  function mockRouter() {
    const refresh = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh,
      prefetch: vi.fn(),
    });
    return refresh;
  }

  async function startEditing() {
    render(
      <AppProviders>
        <RocketCard rocket={rocketSummary} />
      </AppProviders>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Rename acme-1" }));
    await screen.findByRole("textbox", { name: "Rocket name" });
  }

  // Reveal swaps its wrapper after mount, so the input node is re-queried
  // at every step instead of being held across renders.
  const nameInput = () => screen.getByRole("textbox", { name: "Rocket name" });

  it("saves the new name on Enter, shows it and refreshes the server list", async () => {
    const refresh = mockRouter();
    renameRocketMock.mockResolvedValueOnce({ ...rocketSummary, name: "Acme Mk II" });
    await startEditing();

    expect(nameInput()).toHaveValue("acme-1");
    fireEvent.change(nameInput(), { target: { value: "  Acme Mk II " } });
    fireEvent.submit(nameInput());

    expect(await screen.findByRole("heading", { name: "Acme Mk II" })).toBeInTheDocument();
    expect(renameRocketMock).toHaveBeenCalledWith("rocket-1", "Acme Mk II");
    expect(screen.queryByRole("textbox", { name: "Rocket name" })).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("Escape cancels without saving", async () => {
    await startEditing();
    fireEvent.change(nameInput(), { target: { value: "Something else" } });
    fireEvent.keyDown(nameInput(), { key: "Escape" });

    expect(screen.getByRole("heading", { name: "acme-1" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Rocket name" })).not.toBeInTheDocument();
    expect(renameRocketMock).not.toHaveBeenCalled();
  });

  it("the Cancel button closes the editor without saving", async () => {
    await startEditing();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("heading", { name: "acme-1" })).toBeInTheDocument();
    expect(renameRocketMock).not.toHaveBeenCalled();
  });

  it("a blank name cannot be saved", async () => {
    await startEditing();
    fireEvent.change(nameInput(), { target: { value: "   " } });

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.submit(nameInput());
    expect(renameRocketMock).not.toHaveBeenCalled();
  });

  it("an unchanged name closes the editor without a request", async () => {
    await startEditing();
    fireEvent.change(nameInput(), { target: { value: " acme-1 " } });
    fireEvent.submit(nameInput());

    expect(screen.queryByRole("textbox", { name: "Rocket name" })).not.toBeInTheDocument();
    expect(renameRocketMock).not.toHaveBeenCalled();
  });

  it("limits the name to 120 characters", async () => {
    await startEditing();
    expect(nameInput()).toHaveAttribute("maxLength", "120");
  });

  it("a failed save keeps the editor and the typed name, with an inline error", async () => {
    renameRocketMock.mockRejectedValueOnce(new ApiError(500, "boom", { code: "requestFailed" }));
    await startEditing();
    fireEvent.change(nameInput(), { target: { value: "Acme Mk II" } });
    fireEvent.submit(nameInput());

    const error = await screen.findByText("Could not rename this rocket. Please try again.");
    expect(error).toHaveAttribute("aria-live", "polite");
    expect(screen.getByRole("textbox", { name: "Rocket name" })).toHaveValue("Acme Mk II");
  });
});
