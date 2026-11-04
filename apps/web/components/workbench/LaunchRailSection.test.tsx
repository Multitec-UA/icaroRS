import { describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { WizardProvider, useWizardDraft } from "@/components/wizard/WizardProvider";
import { LaunchRailSection } from "./LaunchRailSection";

const MANIFEST = { flight: { rail_length: 5.2, inclination: 85, heading: 90 } };

let draft: ReturnType<typeof useWizardDraft> | null = null;

function Probe({ manifest }: { manifest: Record<string, unknown> | null }) {
  const value = useWizardDraft();
  useEffect(() => {
    draft = value;
  });
  const { setExport } = value;
  useEffect(() => {
    if (manifest) setExport("export-1", manifest);
  }, [manifest, setExport]);
  return null;
}

function renderRail(manifest: Record<string, unknown> | null = MANIFEST, extra?: ReactNode) {
  return render(
    <LocaleProvider initialLocale="en">
      <WizardProvider>
        <Probe manifest={manifest} />
        <LaunchRailSection errors={[]} />
        {extra}
      </WizardProvider>
    </LocaleProvider>,
  );
}

describe("LaunchRailSection (S4)", () => {
  it("prefills each field from the .ork with a 'From .ork' badge", () => {
    renderRail();
    expect(screen.getByLabelText("Rail length (m)")).toHaveValue(5.2);
    expect(screen.getByLabelText("Inclination (°)")).toHaveValue(85);
    expect(screen.getByLabelText("Heading (°)")).toHaveValue(90);
    expect(screen.getAllByText("From .ork")).toHaveLength(3);
    expect(screen.queryByText("Overridden")).toBeNull();
  });

  it("states the inclination and heading conventions", () => {
    renderRail();
    expect(screen.getByText("From horizontal: 90° = vertical")).toBeInTheDocument();
    expect(screen.getByText("Compass bearing the rail leans toward: 90° = east")).toBeInTheDocument();
  });

  it("adds the OpenRocket reading of the inclination, from the current field value (S12d)", () => {
    renderRail();
    expect(screen.getByText("= 5° from vertical in OpenRocket")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Inclination (°)"), { target: { value: "84.25" } });
    expect(screen.getByText("From horizontal: 90° = vertical")).toBeInTheDocument();
    expect(screen.getByText("= 5.8° from vertical in OpenRocket")).toBeInTheDocument();
  });

  it("typing the file's own value back is no override: the badge returns to 'From .ork' (S12b)", () => {
    renderRail();
    fireEvent.change(screen.getByLabelText("Inclination (°)"), { target: { value: "84" } });
    expect(screen.getByText("Overridden")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Inclination (°)"), { target: { value: "85.0" } });
    expect(screen.queryByText("Overridden")).toBeNull();
    expect(screen.getAllByText("From .ork")).toHaveLength(3);
    expect(draft?.state.railOverrides).toEqual({});
  });

  it("an edit shows 'Overridden' and a Reset that restores the file value", () => {
    renderRail();
    fireEvent.change(screen.getByLabelText("Inclination (°)"), { target: { value: "84" } });

    expect(screen.getByLabelText("Inclination (°)")).toHaveValue(84);
    expect(screen.getByText("Overridden")).toBeInTheDocument();
    expect(screen.getAllByText("From .ork")).toHaveLength(2);
    expect(draft?.state.railOverrides).toEqual({ inclination: 84 });

    fireEvent.click(screen.getByRole("button", { name: "Reset to 85°" }));

    expect(screen.getByLabelText("Inclination (°)")).toHaveValue(85);
    expect(screen.queryByText("Overridden")).toBeNull();
    expect(draft?.state.railOverrides).toEqual({});
    expect(draft && "rail" in draft.scenarioBody()).toBe(false);
  });

  it("clearing a field and leaving it drops the override", () => {
    renderRail();
    // Fresh queries each time: the test-only motion stub may re-mount nodes.
    const length = () => screen.getByLabelText("Rail length (m)");
    fireEvent.change(length(), { target: { value: "3" } });
    expect(draft?.state.railOverrides).toEqual({ length: 3 });

    fireEvent.change(length(), { target: { value: "" } });
    // While typing, an empty field is not a reset yet.
    expect(length()).toHaveValue(null);
    expect(draft?.state.railOverrides).toEqual({ length: 3 });
    fireEvent.blur(length());
    expect(draft?.state.railOverrides).toEqual({});
    expect(length()).toHaveValue(5.2);
  });

  it("an override survives a file switch and shows against the new defaults", () => {
    renderRail();
    fireEvent.change(screen.getByLabelText("Heading (°)"), { target: { value: "45" } });
    act(() => draft?.setExport("export-2", { flight: { rail_length: 2, inclination: 87, heading: 0 } }));

    expect(screen.getByLabelText("Heading (°)")).toHaveValue(45);
    expect(screen.getByText("Overridden")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset to 0°" })).toBeInTheDocument();
    expect(screen.getByLabelText("Rail length (m)")).toHaveValue(2);
  });

  it("with no file the fields are disabled with the 'From your .ork' placeholder", () => {
    renderRail(null);
    for (const label of ["Rail length (m)", "Inclination (°)", "Heading (°)"]) {
      const input = screen.getByLabelText(label);
      expect(input).toBeDisabled();
      expect(input).toHaveAttribute("placeholder", "From your .ork");
      expect(input).toHaveValue(null);
    }
    expect(screen.queryByText("From .ork")).toBeNull();
  });
});
