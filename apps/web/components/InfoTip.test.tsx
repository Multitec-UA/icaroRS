import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { InfoTip } from "./InfoTip";

const APOGEE = "The highest point the rocket reaches before it starts falling back down.";

function renderTip(term = "apogee") {
  return render(
    <LocaleProvider initialLocale="en">
      <p>
        Apogee <InfoTip term={term} />
      </p>
      <button type="button">elsewhere</button>
    </LocaleProvider>,
  );
}

/**
 * A toggletip, not a native tooltip: the definition shows on click/tap right
 * away (no hover delay, works on touch) and never relies on `title`.
 */
describe("InfoTip", () => {
  it("is a named, collapsed button with no native title tooltip", () => {
    renderTip();

    const trigger = screen.getByRole("button", { name: "More information" });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).not.toHaveAttribute("title");
    expect(screen.queryByText(APOGEE)).toBeNull();
  });

  it("shows the definition on click and hides it on a second click", () => {
    renderTip();
    const trigger = screen.getByRole("button", { name: "More information" });

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("status")).toHaveTextContent(APOGEE);

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(APOGEE)).toBeNull();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    renderTip();
    const trigger = screen.getByRole("button", { name: "More information" });
    fireEvent.click(trigger);

    fireEvent.keyDown(document, { key: "Escape" });

    expect(screen.queryByText(APOGEE)).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("closes on a press outside", () => {
    renderTip();
    fireEvent.click(screen.getByRole("button", { name: "More information" }));

    fireEvent.pointerDown(screen.getByRole("button", { name: "elsewhere" }));

    expect(screen.queryByText(APOGEE)).toBeNull();
  });

  it("renders nothing for a term without a glossary entry", () => {
    renderTip("not_a_term");
    expect(screen.queryByRole("button", { name: "More information" })).toBeNull();
  });
});
