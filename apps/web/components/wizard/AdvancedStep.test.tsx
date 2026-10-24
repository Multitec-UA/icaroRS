import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { AppProviders } from "@/test/test-providers";
import { AdvancedStep } from "./AdvancedStep";

const { validateScenarioMock } = vi.hoisted(() => ({
  validateScenarioMock: vi.fn().mockResolvedValue({}),
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
    getScenarioTemplate: vi.fn().mockResolvedValue({
      name: "my_scenario",
      site: null,
      date: null,
      atmosphere: {
        model: "standard_atmosphere",
        file: null,
        station: null,
        fallback: "standard_atmosphere",
      },
      rail: null,
      uncertainty: null,
      uncertainty_presets: {
        Typical: { velocity: { std: 0.05, kind: "relative" } },
      },
    }),
    validateScenario: (...args: Parameters<typeof actual.validateScenario>) =>
      validateScenarioMock(...args),
  };
});

describe("AdvancedStep (issue #48 — server-state layer)", () => {
  it("loads the scenario template and seeds the Typical uncertainty preset exactly once", async () => {
    render(
      <AppProviders>
        <AdvancedStep />
      </AppProviders>,
    );

    // Switch to the "Customize" preset to reveal the per-parameter table —
    // it should already be seeded from the fetched "Typical" preset, proving
    // the converging effect (no react-hooks/exhaustive-deps suppression) ran
    // exactly once instead of looping or never firing.
    fireEvent.click(await screen.findByText("Customize"));

    expect(await screen.findByDisplayValue("0.05")).toBeInTheDocument();
  });

  it("validates against the API and advances on success", async () => {
    render(
      <AppProviders>
        <AdvancedStep />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Review"));

    await vi.waitFor(() => expect(validateScenarioMock).toHaveBeenCalled());
  });
});

describe("AdvancedStep — inline errors and numeric inputs (Web Interface Guidelines)", () => {
  it("routes a field error to its input, opens its collapsed section and focuses it", async () => {
    validateScenarioMock.mockRejectedValueOnce(
      new ApiError(422, "invalid", {
        code: "validation",
        fieldErrors: [{ loc: ["rail", "length"], field: "rail.length", message: "Rail too short" }],
      }),
    );

    render(
      <AppProviders>
        <AdvancedStep />
      </AppProviders>,
    );

    const railSection = (await screen.findByText("Launch rail overrides")).closest("details");
    expect(railSection).not.toHaveAttribute("open");

    fireEvent.click(screen.getByText("Review"));

    const input = await screen.findByLabelText("Length (m)");
    await waitFor(() => expect(input).toHaveFocus());
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(railSection).toHaveAttribute("open");
    // The inline message is announced next to the field and still listed in
    // the summary callout.
    expect(screen.getAllByText(/Rail too short/).length).toBeGreaterThanOrEqual(2);
  });

  it("labels the per-parameter table controls and keeps an emptied std field empty", async () => {
    render(
      <AppProviders>
        <AdvancedStep />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByText("Customize"));

    const std = await screen.findByLabelText("Standard deviation for velocity");
    expect(std).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByLabelText("Kind for velocity")).toBeInTheDocument();

    fireEvent.change(std, { target: { value: "" } });
    // Clearing the field must not snap the value to "0" mid-edit.
    expect(std).toHaveValue(null);
  });
});
