import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AppProviders } from "@/test/test-providers";
import { RocketStep } from "./RocketStep";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    getIdentity: vi.fn().mockResolvedValue({
      user_id: "u1",
      org_id: "o1",
      email: "pilot@multitec.dev",
    }),
  };
});

describe("RocketStep — keyboard-operable dropzone", () => {
  it("exposes the file input as a labelled, focusable control bound to the dropzone label", async () => {
    render(
      <AppProviders>
        <RocketStep />
      </AppProviders>,
    );

    const input = await screen.findByLabelText("OpenRocket .ork file");
    expect(input).toHaveAttribute("type", "file");
    // `hidden` removes the control from the tab order; it must be visually
    // hidden (sr-only) instead so keyboard users can reach it.
    expect(input).not.toHaveAttribute("hidden");
    expect(input).toHaveAttribute("name", "rocket-file");

    // The dropzone is the input's <label>, so clicking/activating it opens
    // the picker natively — no div onClick needed.
    const label = document.querySelector(`label[for="${input.id}"]`);
    expect(label).not.toBeNull();
    expect(label).toHaveTextContent("Drag & drop your .ork file here");

    input.focus();
    expect(input).toHaveFocus();
  });
});
