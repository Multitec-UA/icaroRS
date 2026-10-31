import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import {
  Button,
  ButtonLink,
  Card,
  Disclosure,
  Field,
  Kbd,
  Select,
  StatusPill,
  TextInput,
  buttonClass,
  chipButton,
  ghostButton,
  primaryButton,
} from "@/components/ui";

function inLocale(node: React.ReactNode) {
  return render(<LocaleProvider initialLocale="en">{node}</LocaleProvider>);
}

/** The kit is the single token-based control system (S2). */
describe("ui kit — Button", () => {
  it("renders the primary variant at 36 px on the primary tokens", () => {
    render(<Button>Run</Button>);
    const button = screen.getByRole("button", { name: "Run" });
    expect(button.className).toContain("h-9");
    expect(button.className).toContain("rounded-[9px]");
    expect(button.className).toContain("bg-primary");
    expect(button.className).toContain("text-on-primary");
  });

  it("renders ghost and chip variants on their tokens", () => {
    render(
      <>
        <Button variant="ghost">Cancel</Button>
        <Button variant="chip">Other</Button>
      </>,
    );
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("bg-surface");
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("border-border");
    expect(screen.getByRole("button", { name: "Other" }).className).toContain("bg-chip");
  });

  it("grows the hit area to 44 px under a coarse pointer", () => {
    render(<Button>Run</Button>);
    expect(screen.getByRole("button", { name: "Run" }).className).toContain("pointer-coarse:min-h-11");
  });

  it("defaults to type=button so it never submits a form by accident", () => {
    render(<Button>Run</Button>);
    expect(screen.getByRole("button", { name: "Run" })).toHaveAttribute("type", "button");
  });

  it("ButtonLink is a real anchor with the same classes as the button", () => {
    render(
      <ButtonLink href="/runs" variant="ghost">
        Runs
      </ButtonLink>,
    );
    const link = screen.getByRole("link", { name: "Runs" });
    expect(link).toHaveAttribute("href", "/runs");
    expect(link.className).toBe(buttonClass({ variant: "ghost" }));
  });

  it("exposes the class builders the Workbench styles re-export", () => {
    expect(primaryButton).toBe(buttonClass({ variant: "primary" }));
    expect(ghostButton).toBe(buttonClass({ variant: "ghost" }));
    expect(chipButton).toBe(buttonClass({ variant: "chip" }));
    expect(buttonClass({ variant: "primary", size: "sm" })).toContain("h-8");
  });

  it("uses no literal colour in any variant", () => {
    for (const variant of ["primary", "ghost", "chip", "danger"] as const) {
      expect(buttonClass({ variant })).not.toMatch(/-(?:white|black|cyan|rose|emerald|slate|zinc|gray)\b|#[0-9a-f]{3}/);
    }
  });
});

describe("ui kit — StatusPill", () => {
  it.each([
    ["ok", "bg-ok-soft", "text-ok-ink"],
    ["warn", "bg-warn-soft", "text-warn-ink"],
    ["bad", "bg-bad-soft", "text-bad-ink"],
    ["neutral", "bg-chip", "text-ink-2"],
  ] as const)("tone %s renders %s / %s", (tone, bg, ink) => {
    render(<StatusPill tone={tone}>Up to date</StatusPill>);
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("Up to date");
    expect(pill.className).toContain(bg);
    expect(pill.className).toContain(ink);
  });

  it("shows a decorative dot by default and can hide it", () => {
    const { container, rerender } = render(<StatusPill tone="ok">Done</StatusPill>);
    expect(container.querySelector("[data-pill-dot]")).not.toBeNull();
    rerender(
      <StatusPill tone="ok" dot={false}>
        Done
      </StatusPill>,
    );
    expect(container.querySelector("[data-pill-dot]")).toBeNull();
  });

  it("shows a decorative spinner (the pill text is the announcement)", () => {
    inLocale(
      <StatusPill tone="neutral" spinner>
        Running…
      </StatusPill>,
    );
    const pill = screen.getByRole("status");
    expect(pill).toHaveTextContent("Running…");
    expect(pill.querySelector(".animate-spin")).toHaveAttribute("aria-hidden", "true");
    // Only one status region: the spinner does not announce "Loading" twice.
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});

describe("ui kit — Disclosure", () => {
  it("is a <details> with a summary, a meta slot and an open state", () => {
    const { container } = render(
      <Disclosure title="All results" count={16} meta="Every scalar">
        <p>body</p>
      </Disclosure>,
    );
    const details = container.querySelector("details")!;
    expect(details).not.toHaveAttribute("open");
    const summary = container.querySelector("summary")!;
    expect(summary).toHaveTextContent("All results");
    expect(summary).toHaveTextContent("(16)");
    expect(summary).toHaveTextContent("Every scalar");
  });

  it("toggles from the keyboard and reports the open state", () => {
    const seen: boolean[] = [];
    const { container } = render(
      <Disclosure title="Plots" onToggle={(open) => seen.push(open)}>
        <p>body</p>
      </Disclosure>,
    );
    const details = container.querySelector("details")!;
    const summary = container.querySelector("summary")!;
    summary.focus();
    expect(summary).toHaveFocus();
    // jsdom does not implement the native summary activation, so the kit
    // handles Enter / Space itself and stays consistent with browsers.
    fireEvent.keyDown(summary, { key: "Enter" });
    expect(details).toHaveAttribute("open");
    fireEvent.keyDown(summary, { key: " " });
    expect(details).not.toHaveAttribute("open");
    expect(seen).toEqual([true, false]);
  });

  it("can start open", () => {
    const { container } = render(
      <Disclosure title="Plots" defaultOpen>
        <p>body</p>
      </Disclosure>,
    );
    expect(container.querySelector("details")).toHaveAttribute("open");
  });
});

describe("ui kit — Field, TextInput, Select, Card, Kbd", () => {
  it("renders 36 px inputs and selects on tokens, wired to the label", () => {
    inLocale(
      <>
        <Field label="Length" htmlFor="len" hint="metres">
          <TextInput id="len" />
        </Field>
        <Field label="Model" htmlFor="model">
          <Select id="model">
            <option>a</option>
          </Select>
        </Field>
      </>,
    );
    const input = screen.getByLabelText("Length");
    expect(input.className).toContain("h-9");
    expect(input.className).toContain("bg-surface");
    expect(input).toHaveAccessibleDescription("metres");
    const select = screen.getByLabelText("Model");
    expect(select.tagName).toBe("SELECT");
    expect(select.className).toContain("h-9");
  });

  it("shows the error on the bad tokens as an alert", () => {
    inLocale(
      <Field label="Length" htmlFor="len" error="Too short">
        <TextInput id="len" />
      </Field>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Too short");
    expect(alert.className).toContain("text-bad-ink");
    expect(screen.getByLabelText("Length")).toHaveAttribute("aria-invalid", "true");
  });

  it("Card is a token surface with a border", () => {
    const { container } = render(<Card>hi</Card>);
    const card = container.firstElementChild!;
    expect(card.className).toContain("bg-surface");
    expect(card.className).toContain("border-border");
  });

  it("Kbd renders a keyboard hint", () => {
    render(<Kbd>⌘↵</Kbd>);
    expect(screen.getByText("⌘↵").tagName).toBe("KBD");
  });
});
