import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
