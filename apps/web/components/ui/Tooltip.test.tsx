import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { Tooltip } from "./Tooltip";

function renderTip() {
  render(
    <Tooltip label="View report">
      <a href="/r" aria-label="View report">
        ·
      </a>
    </Tooltip>,
  );
  return screen.getByRole("link", { name: "View report" });
}

describe("Tooltip", () => {
  it("is hidden until the control is hovered, and leaves with the pointer", () => {
    const link = renderTip();
    expect(screen.queryByText("View report")).toBeNull();
    fireEvent.mouseEnter(link.parentElement as HTMLElement);
    expect(screen.getByText("View report")).toBeInTheDocument();
    fireEvent.mouseLeave(link.parentElement as HTMLElement);
    expect(screen.queryByText("View report")).toBeNull();
  });

  it("shows on keyboard focus too, and hides on blur", () => {
    const link = renderTip();
    fireEvent.focus(link);
    expect(screen.getByText("View report")).toBeInTheDocument();
    fireEvent.blur(link);
    expect(screen.queryByText("View report")).toBeNull();
  });

  it("Escape dismisses it without moving focus (WCAG 1.4.13)", () => {
    const link = renderTip();
    link.focus();
    fireEvent.focus(link);
    fireEvent.keyDown(link, { key: "Escape" });
    expect(screen.queryByText("View report")).toBeNull();
    expect(document.activeElement).toBe(link);
  });

  it("is decorative for assistive tech: the control's own aria-label names it", () => {
    const link = renderTip();
    fireEvent.focus(link);
    expect(screen.getByText("View report")).toHaveAttribute("aria-hidden", "true");
    expect(link).toHaveAccessibleName("View report");
  });
});
