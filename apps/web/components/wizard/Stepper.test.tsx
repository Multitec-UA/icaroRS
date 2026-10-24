import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { WizardProvider } from "./WizardProvider";
import { Stepper } from "./Stepper";

function renderStepper() {
  return render(
    <LocaleProvider initialLocale="en">
      <WizardProvider>
        <Stepper />
      </WizardProvider>
    </LocaleProvider>,
  );
}

describe("Stepper — landmark and current-step semantics", () => {
  it("is a labelled navigation landmark wrapping the step list", () => {
    renderStepper();

    const nav = screen.getByRole("navigation", { name: "Simulation steps" });
    expect(nav.querySelector("ol")).not.toBeNull();
  });

  it("marks only the active step with aria-current=step", () => {
    renderStepper();

    expect(screen.getByRole("button", { name: /Rocket/ })).toHaveAttribute("aria-current", "step");
    expect(screen.getByRole("button", { name: /Launch site & time/ })).not.toHaveAttribute(
      "aria-current",
    );
  });
});
