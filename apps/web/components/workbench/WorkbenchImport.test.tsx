import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { useWizard } from "@/components/wizard/WizardProvider";
import { WorkbenchShell } from "./WorkbenchShell";

/**
 * S8 — the `.ork` import states inside the Workbench (T7): A1 (no export),
 * the destination card chosen BEFORE the upload (L14), A2 (converting,
 * honest progress) and A3 (the rocket panel).
 */

const {
  simulateMock,
  getScenarioTemplateMock,
  suggestAtmosphereMock,
  getElevationMock,
  getRocketsMock,
  getRocketMock,
  getExportMock,
  convertMock,
  getHistoryMock,
} = vi.hoisted(() => ({
  simulateMock: vi.fn(),
  getScenarioTemplateMock: vi.fn(),
  suggestAtmosphereMock: vi.fn(),
  getElevationMock: vi.fn(),
  getRocketsMock: vi.fn(),
  getRocketMock: vi.fn(),
  getExportMock: vi.fn(),
  convertMock: vi.fn(),
  getHistoryMock: vi.fn(),
}));

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
    getScenarioTemplate: (...args: Parameters<typeof actual.getScenarioTemplate>) =>
      getScenarioTemplateMock(...args),
    suggestAtmosphere: (...args: Parameters<typeof actual.suggestAtmosphere>) =>
      suggestAtmosphereMock(...args),
    getElevation: (...args: Parameters<typeof actual.getElevation>) => getElevationMock(...args),
    getRockets: (...args: Parameters<typeof actual.getRockets>) => getRocketsMock(...args),
    getRocket: (...args: Parameters<typeof actual.getRocket>) => getRocketMock(...args),
    getExport: (...args: Parameters<typeof actual.getExport>) => getExportMock(...args),
    convert: (...args: Parameters<typeof actual.convert>) => convertMock(...args),
    getHistory: (...args: Parameters<typeof actual.getHistory>) => getHistoryMock(...args),
  };
});

vi.mock("@/components/map/SitePicker", () => ({
  SitePicker: () => <div>site-picker-stub</div>,
}));

const TEMPLATE = {
  name: "template",
  site: null,
  date: null,
  atmosphere: { model: "standard_atmosphere", file: null, station: null, fallback: "standard_atmosphere" },
  rail: null,
  uncertainty: null,
  uncertainty_presets: {
    Typical: { mass: { std: 0.02, kind: "relative" } },
    Conservative: { mass: { std: 0.05, kind: "relative" } },
    Precise: { mass: { std: 0.01, kind: "relative" } },
  },
};

const RESULT = { run_id: "run-7f3a", scalars: { apogee: 3142 }, plot_urls: [], warnings: [] };

const ROCKETS = [
  { rocket_id: "rk-1", name: "Icarus-2", created_by: "A. Ruiz", created_at: "2026-10-02T10:00:00Z" },
  { rocket_id: "rk-2", name: "Icarus-1", created_by: "M. Soler", created_at: "2026-06-11T10:00:00Z" },
];

function exportOf(rocketId: string, exportId: string, filename: string, createdAt: string) {
  return {
    export_id: exportId,
    rocket_id: rocketId,
    name: filename.replace(/\.ork$/, ""),
    created_at: createdAt,
    created_by: "A. Ruiz",
    export_prefix: `orgs/o1/exports/${exportId}/`,
    gcs_ref: `orgs/o1/exports/${exportId}/`,
    ork_filename: filename,
    has_source_ork: true,
  };
}

// Newest first, as the API returns them.
const RK1_EXPORTS = [
  exportOf("rk-1", "ex-new", "icarus2_v4.ork", "2026-10-20T10:00:00Z"),
  exportOf("rk-1", "ex-old", "icarus2.ork", "2026-10-02T10:00:00Z"),
];
const RK2_EXPORTS = [exportOf("rk-2", "ex-r2", "icarus1.ork", "2026-06-11T10:00:00Z")];

function armRocketApi() {
  getRocketsMock.mockResolvedValue(ROCKETS);
  getRocketMock.mockImplementation(async (rocketId: string) => {
    if (rocketId === "rk-1") return { ...ROCKETS[0], exports: RK1_EXPORTS };
    if (rocketId === "rk-2") return { ...ROCKETS[1], exports: RK2_EXPORTS };
    throw new ApiError(404, `Rocket '${rocketId}' not found.`);
  });
  getExportMock.mockImplementation(async (exportId: string) => {
    const exp = [...RK1_EXPORTS, ...RK2_EXPORTS].find((e) => e.export_id === exportId);
    if (!exp) throw new ApiError(404, `Export '${exportId}' not found.`);
    return { ...exp, manifest: { name: exp.rocket_id === "rk-1" ? "Icarus-2" : "Icarus-1" } };
  });
}

function arm() {
  getScenarioTemplateMock.mockResolvedValue(TEMPLATE);
  suggestAtmosphereMock.mockResolvedValue({ model: "forecast", reason: "ok", needs_internet: true });
  getElevationMock.mockResolvedValue({ elevation: 12, source: "dem" });
}

afterEach(() => {
  for (const m of [
    simulateMock,
    getScenarioTemplateMock,
    suggestAtmosphereMock,
    getElevationMock,
    getRocketsMock,
    getRocketMock,
    getExportMock,
    convertMock,
  ]) {
    m.mockReset();
  }
});

/** Seeds the launch site the way the map would, so Run can become enabled. */
function Driver() {
  const { setSite } = useWizard();
  return (
    <button
      type="button"
      onClick={() => setSite({ latitude: 38.3452, longitude: -0.481, elevation: 12 })}
    >
      seed-site
    </button>
  );
}

async function renderShell() {
  render(
    <AppProviders>
      <Driver />
      <WorkbenchShell />
    </AppProviders>,
  );
  return screen.findByRole("button", { name: /Run simulation/ });
}

/**
 * The import asks where a file goes until it knows the org has no rockets,
 * so an "empty org" test must let GET /api/rockets settle before picking.
 */
async function renderShellWithEmptyOrg() {
  getRocketsMock.mockResolvedValue([]);
  const run = await renderShell();
  await waitFor(() => expect(screen.queryByText("Loading rockets…")).toBeNull());
  return run;
}

function orkFile(name = "icarus2_v4.ork") {
  return new File(["<openrocket/>"], name, { type: "application/octet-stream" });
}

function dropZoneInput() {
  return screen.getByLabelText("OpenRocket .ork file");
}

function chooseFile(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } });
}

async function useRocket(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: `Use ${name}` }));
}

async function openPanel() {
  const trigger = await screen.findByRole("button", { name: /Icarus-2 · / });
  fireEvent.click(trigger);
  return { trigger, dialog: await screen.findByRole("dialog") };
}

describe("Workbench import — A1 no export (S8)", () => {
  it("shows the drop zone and the org's converted rockets with a Use action, without per-row detail fetches", async () => {
    arm();
    armRocketApi();
    await renderShell();

    expect(screen.getByText("Drop your OpenRocket file here")).toBeInTheDocument();
    expect(dropZoneInput()).toHaveAttribute("accept", ".ork");
    expect(await screen.findByText("Or pick one already converted")).toBeInTheDocument();
    expect(screen.getByText("Icarus-2")).toBeInTheDocument();
    expect(screen.getByText("A. Ruiz")).toBeInTheDocument();
    expect(screen.getByText("Icarus-1")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Use / })).toHaveLength(2);
    expect(getRocketMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Results, the 3D replay and plots appear here after the first run.")).toBeNull();
  });

  it("shows only the drop zone when the org has no rockets yet", async () => {
    arm();
    getRocketsMock.mockResolvedValue([]);
    await renderShell();

    await waitFor(() => expect(getRocketsMock).toHaveBeenCalled());
    expect(screen.getByText("Drop your OpenRocket file here")).toBeInTheDocument();
    expect(screen.queryByText("Or pick one already converted")).toBeNull();
  });

  it("Use loads the rocket's newest export and names rocket and file in the top bar", async () => {
    arm();
    armRocketApi();
    await renderShell();

    await useRocket("Icarus-2");

    expect(await screen.findByText("Icarus-2 · icarus2_v4.ork")).toBeInTheDocument();
    expect(getRocketMock).toHaveBeenCalledWith("rk-1");
    expect(getExportMock).toHaveBeenCalledWith("ex-new");
    expect(screen.getByText("Results, the 3D replay and plots appear here after the first run.")).toBeInTheDocument();
  });

  it("keeps Launch rail and Uncertainty disabled with a note until an export exists", async () => {
    arm();
    armRocketApi();
    await renderShell();

    const note = "Defaults come from your .ork once it's loaded";
    expect(screen.getByText(note)).toBeInTheDocument();
    expect(screen.getByLabelText("Length (m)")).toBeDisabled();
    // Asserted through a live query: the test-only motion/react stub re-mounts
    // the DOM under <Reveal> on every render, so an awaited node can go stale.
    await waitFor(() => expect(screen.getByRole("button", { name: "Typical" })).toBeDisabled());
    // Launch site and Time & weather stay editable.
    expect(screen.getByLabelText("Latitude")).toBeEnabled();

    await useRocket("Icarus-2");

    await waitFor(() => expect(screen.getByLabelText("Length (m)")).toBeEnabled());
    expect(screen.getByRole("button", { name: "Typical" })).toBeEnabled();
    expect(screen.queryByText(note)).toBeNull();
  });
});

describe("Workbench import — destination before upload (S8, L14)", () => {
  it("asks where the file goes with New rocket preselected, and Convert sends no rocket_id", async () => {
    arm();
    armRocketApi();
    convertMock.mockResolvedValue({ export_id: "ex-x", rocket_id: "rk-x", manifest: { name: "Icarus-3" } });
    await renderShell();
    await screen.findByText("Or pick one already converted");

    const file = orkFile("icarus3.ork");
    chooseFile(dropZoneInput(), file);

    expect(await screen.findByText("Where does this file go?")).toBeInTheDocument();
    expect(screen.getByText("icarus3.ork")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /New rocket/ })).toBeChecked();
    expect(screen.getByRole("radio", { name: /Add to one of my rockets/ })).not.toBeChecked();
    expect(screen.getByText("Nothing is guessed from the file name.", { exact: false })).toBeInTheDocument();
    expect(convertMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    await waitFor(() => expect(convertMock).toHaveBeenCalledTimes(1));
    expect(convertMock.mock.calls[0][0]).toBe(file);
    expect(convertMock.mock.calls[0][1]).toBeUndefined();
    expect(await screen.findByText("Icarus-3 · icarus3.ork")).toBeInTheDocument();
  });

  it("names the context after the rocket the user chose, not after the file's own design name", async () => {
    arm();
    armRocketApi();
    convertMock.mockResolvedValue({ export_id: "ex-z", rocket_id: "rk-1", manifest: { name: "Icarus 2 Mk5" } });
    await renderShell();
    await screen.findByText("Or pick one already converted");

    const file = orkFile();
    chooseFile(dropZoneInput(), file);
    await screen.findByText("Where does this file go?");
    fireEvent.click(screen.getByRole("radio", { name: /Add to one of my rockets/ }));
    fireEvent.change(screen.getByRole("combobox", { name: "Rocket to add this file to" }), { target: { value: "rk-1" } });
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    await waitFor(() => expect(convertMock).toHaveBeenCalledWith(file, "rk-1"));
    expect(await screen.findByText(`Icarus-2 · ${file.name}`)).toBeInTheDocument();
    expect(screen.queryByText(/Icarus 2 Mk5/)).toBeNull();
  });

  it("Add to one of my rockets keeps Convert disabled until a rocket is picked, then sends its id", async () => {
    arm();
    armRocketApi();
    convertMock.mockResolvedValue({ export_id: "ex-y", rocket_id: "rk-1", manifest: { name: "Icarus-2" } });
    await renderShell();
    await screen.findByText("Or pick one already converted");

    const file = orkFile();
    chooseFile(dropZoneInput(), file);
    await screen.findByText("Where does this file go?");

    fireEvent.click(screen.getByRole("radio", { name: /Add to one of my rockets/ }));
    expect(screen.getByRole("button", { name: "Convert" })).toBeDisabled();

    const select = screen.getByRole("combobox", { name: "Rocket to add this file to" });
    expect(within(select).getByRole("option", { name: "Choose a rocket…" })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: "rk-1" } });
    // Re-queried on purpose: the test-only motion/react stub re-mounts the
    // DOM under <Reveal> on every render, so a node captured earlier is stale.
    expect(screen.getByRole("button", { name: "Convert" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Convert" }));

    await waitFor(() => expect(convertMock).toHaveBeenCalledWith(file, "rk-1"));
  });

  it("Cancel discards the file and brings the drop zone back", async () => {
    arm();
    armRocketApi();
    await renderShell();
    await screen.findByText("Or pick one already converted");

    chooseFile(dropZoneInput(), orkFile());
    await screen.findByText("Where does this file go?");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.queryByText("Where does this file go?")).toBeNull();
    expect(screen.getByText("Drop your OpenRocket file here")).toBeInTheDocument();
    expect(convertMock).not.toHaveBeenCalled();
  });

  it("converts immediately as a new rocket when the org has no rockets", async () => {
    arm();
    convertMock.mockResolvedValue({ export_id: "ex-x", rocket_id: "rk-x", manifest: { name: "Icarus-3" } });
    await renderShellWithEmptyOrg();

    const file = orkFile("icarus3.ork");
    chooseFile(dropZoneInput(), file);

    await waitFor(() => expect(convertMock).toHaveBeenCalledWith(file, undefined));
    expect(screen.queryByText("Where does this file go?")).toBeNull();
    expect(await screen.findByText("Icarus-3 · icarus3.ork")).toBeInTheDocument();
  });
});

describe("Workbench import — A2 converting (S8)", () => {
  it("shows the honest converting state, disables Run, and sets the export on success", async () => {
    arm();
    let finish: (value: unknown) => void = () => {};
    convertMock.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    const run = await renderShellWithEmptyOrg();
    fireEvent.click(screen.getByText("seed-site"));

    chooseFile(dropZoneInput(), orkFile());

    expect(await screen.findByText("icarus2_v4.ork converting…")).toBeInTheDocument();
    expect(run).toBeDisabled();
    expect(screen.getByText("Converting icarus2_v4.ork")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Conversion in progress" })).not.toHaveAttribute("aria-valuenow");
    expect(screen.getByText("This usually takes under a minute.", { exact: false })).toBeInTheDocument();
    for (const step of [
      "Uploaded",
      "Opened in OpenRocket",
      "Exporting geometry & motor",
      "Building the rocketpy model",
    ]) {
      expect(screen.getByText(step)).toBeInTheDocument();
    }
    // Inputs stay editable while the server works.
    expect(screen.getByLabelText("Latitude")).toBeEnabled();

    finish({ export_id: "ex-new", rocket_id: "rk-1", manifest: { name: "Icarus-2" } });

    expect(await screen.findByText("Icarus-2 · icarus2_v4.ork")).toBeInTheDocument();
    expect(screen.queryByText("Converting icarus2_v4.ork")).toBeNull();
    expect(screen.getByText("Results, the 3D replay and plots appear here after the first run.")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: /Run simulation/ })).toBeEnabled());
  });

  it("names the rocket after the file when the manifest has no name", async () => {
    arm();
    convertMock.mockResolvedValue({ export_id: "ex-n", rocket_id: "rk-n", manifest: {} });
    await renderShellWithEmptyOrg();

    chooseFile(dropZoneInput(), orkFile("payload_sled.ork"));

    expect(await screen.findByText("payload_sled · payload_sled.ork")).toBeInTheDocument();
  });

  it("shows a 503 hint verbatim with a 'Try another file' action", async () => {
    arm();
    convertMock.mockRejectedValueOnce(
      new ApiError(503, "unavailable", { code: "unavailable", hint: "Java is not installed on the server." }),
    );
    await renderShellWithEmptyOrg();

    chooseFile(dropZoneInput(), orkFile());

    expect(await screen.findByText("Java is not installed on the server.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try another file" }));
    expect(screen.queryByText("Java is not installed on the server.")).toBeNull();
    expect(screen.getByText("Drop your OpenRocket file here")).toBeInTheDocument();
  });

  it("rejects a file that is not .ork before any request", async () => {
    arm();
    await renderShellWithEmptyOrg();

    chooseFile(dropZoneInput(), orkFile("notes.txt"));

    expect(
      await screen.findByText("That isn't an OpenRocket file. Please choose a .ork file."),
    ).toBeInTheDocument();
    expect(convertMock).not.toHaveBeenCalled();
  });
});

describe("Workbench import — A3 rocket panel (S8)", () => {
  it("opens from the context button and lists the rocket's files newest first with the active one checked", async () => {
    arm();
    armRocketApi();
    await renderShell();
    await useRocket("Icarus-2");

    const { trigger, dialog } = await openPanel();

    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(within(dialog).getByText("Files in this rocket")).toBeInTheDocument();
    expect(await within(dialog).findByText("2 files")).toBeInTheDocument();
    const radios = within(dialog).getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(radios[0]).toHaveAccessibleName(/icarus2_v4\.ork/);
    expect(radios[0]).toBeChecked();
    expect(radios[1]).toHaveAccessibleName(/icarus2\.ork/);
    expect(radios[1]).not.toBeChecked();
    expect(within(dialog).getByRole("link", { name: "Compare two files" })).toHaveAttribute(
      "href",
      "/runs?rocket_id=rk-1",
    );
  });

  it("shows how many runs each file has, counted from the rocket's history", async () => {
    arm();
    armRocketApi();
    const run = (simulation_id: string, export_id: string) => ({
      simulation_id,
      rocket_id: "rk-1",
      export_id,
      name: "Icarus-2",
      ork_filename: null,
      created_at: "2026-10-01T00:00:00Z",
      created_by: "pilot@multitec.dev",
      status: "done" as const,
      scenario: {},
      scalars: { apogee: 3000 },
      warnings: [],
      result_prefix: "",
      plot_names: [],
      has_series: false,
    });
    getHistoryMock.mockResolvedValue([run("s-1", "ex-new"), run("s-2", "ex-new"), run("s-3", "ex-old")]);
    await renderShell();
    await useRocket("Icarus-2");

    const { dialog } = await openPanel();

    expect(getHistoryMock).toHaveBeenCalledWith(100, undefined, "rk-1");
    expect(await within(dialog).findByText("2 runs")).toBeInTheDocument();
    expect(within(dialog).getByText("1 run")).toBeInTheDocument();
  });

  it("selecting another file keeps the rocket, marks results stale and relabels Run as 'Run this file'", async () => {
    arm();
    armRocketApi();
    simulateMock.mockResolvedValueOnce(RESULT);
    const run = await renderShell();
    await useRocket("Icarus-2");
    fireEvent.click(screen.getByText("seed-site"));
    await waitFor(() => expect(run).toBeEnabled());
    fireEvent.click(run);
    expect(await screen.findByText("Up to date · run run-7f3a")).toBeInTheDocument();
    expect(run).toHaveTextContent("Run simulation");

    const { dialog } = await openPanel();
    fireEvent.click(await within(dialog).findByRole("radio", { name: /icarus2\.ork/ }));

    await waitFor(() => expect(getExportMock).toHaveBeenCalledWith("ex-old"));
    expect(await screen.findByText("Icarus-2 · icarus2.ork")).toBeInTheDocument();
    expect(screen.getByText("Results are from icarus2_v4.ork · run run-7f3a")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run this file/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run simulation/ })).toBeNull();
    // Still the same rocket: the panel keeps listing its files.
    expect(within(dialog).getByRole("radio", { name: /icarus2\.ork/ })).toBeChecked();
  });

  it("closes on Escape and returns focus to the context button", async () => {
    arm();
    armRocketApi();
    await renderShell();
    await useRocket("Icarus-2");

    const { trigger, dialog } = await openPanel();
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(document.activeElement).toBe(trigger);
  });

  it("dropping a file in the panel converts it into this rocket without the destination card", async () => {
    arm();
    armRocketApi();
    convertMock.mockResolvedValue({ export_id: "ex-z", rocket_id: "rk-1", manifest: { name: "Icarus-2" } });
    await renderShell();
    await useRocket("Icarus-2");

    const { dialog } = await openPanel();
    expect(within(dialog).getByText("Drop a .ork to add it to Icarus-2")).toBeInTheDocument();
    const file = orkFile("icarus2_v5.ork");
    chooseFile(within(dialog).getByLabelText("OpenRocket .ork file to add to Icarus-2"), file);

    await waitFor(() => expect(convertMock).toHaveBeenCalledWith(file, "rk-1"));
    expect(screen.queryByText("Where does this file go?")).toBeNull();
    expect(await screen.findByText("Icarus-2 · icarus2_v5.ork")).toBeInTheDocument();
  });

  it("an 'Other rockets' chip switches to that rocket's newest export", async () => {
    arm();
    armRocketApi();
    await renderShell();
    await useRocket("Icarus-2");

    const { dialog } = await openPanel();
    expect(within(dialog).getByText("Other rockets")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "Icarus-1" }));

    await waitFor(() => expect(getRocketMock).toHaveBeenCalledWith("rk-2"));
    expect(getExportMock).toHaveBeenCalledWith("ex-r2");
    expect(await screen.findByText("Icarus-1 · icarus1.ork")).toBeInTheDocument();
  });

  it("'+ New rocket from .ork' goes through the destination card with New rocket preselected", async () => {
    arm();
    armRocketApi();
    await renderShell();
    await useRocket("Icarus-2");

    const { dialog } = await openPanel();
    chooseFile(within(dialog).getByLabelText("+ New rocket from .ork"), orkFile("icarus3.ork"));

    expect(await screen.findByText("Where does this file go?")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /New rocket/ })).toBeChecked();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(convertMock).not.toHaveBeenCalled();
  });
});
