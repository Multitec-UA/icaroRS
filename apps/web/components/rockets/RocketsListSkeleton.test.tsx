import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { RocketsListSkeleton } from "./RocketsListSkeleton";

describe("RocketsListSkeleton — loading state announced once", () => {
  it("exposes a single status region holding the label, with a decorative spinner", () => {
    const { container } = render(
      <LocaleProvider initialLocale="en">
        <RocketsListSkeleton label="Loading rockets…" />
      </LocaleProvider>,
    );

    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent("Loading rockets…");
    expect(container.querySelector(".animate-spin")).toHaveAttribute("aria-hidden", "true");
  });
});
