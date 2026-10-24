import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { ApiError } from "@/lib/api";
import { BasicsStep } from "./BasicsStep";

const { validateScenarioMock } = vi.hoisted(() => ({ validateScenarioMock: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
    validateScenario: (...args: Parameters<typeof actual.validateScenario>) =>
      validateScenarioMock(...args),
  };
});

// SitePicker pulls Leaflet in through next/dynamic — irrelevant to the field
// wiring under test here.
vi.mock("@/components/map/SitePicker", () => ({
  SitePicker: () => <div>site-picker-stub</div>,
}));

afterEach(() => {
  validateScenarioMock.mockReset();
});

describe("BasicsStep — form field contract", () => {
  it("focuses the first field with an error after a failed validation", async () => {
    validateScenarioMock.mockRejectedValueOnce(
      new ApiError(422, "invalid", {
        code: "validation",
        fieldErrors: [
          { loc: ["site", "longitude"], field: "site.longitude", message: "Longitude out of range" },
          { loc: ["site", "elevation"], field: "site.elevation", message: "Elevation out of range" },
        ],
      }),
    );

    render(
      <AppProviders>
        <BasicsStep />
      </AppProviders>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Continue/ }));

    expect(await screen.findByText("Longitude out of range")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Longitude")).toHaveFocus());
    expect(screen.getByLabelText("Latitude")).not.toHaveFocus();
  });

  it("gives the coordinate inputs a name, decimal input mode and no autocomplete", async () => {
    render(
      <AppProviders>
        <BasicsStep />
      </AppProviders>,
    );

    const lat = await screen.findByLabelText("Latitude");
    expect(lat).toHaveAttribute("name", "latitude");
    expect(lat).toHaveAttribute("inputmode", "decimal");
    expect(lat).toHaveAttribute("autocomplete", "off");
  });
});
