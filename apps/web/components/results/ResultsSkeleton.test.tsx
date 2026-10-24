import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { ResultsSkeleton } from "./ResultsSkeleton";

describe("ResultsSkeleton — loading state announced once", () => {
  it("exposes a single status region holding the label, with a decorative spinner", () => {
    const { container } = render(
      <LocaleProvider initialLocale="en">
        <ResultsSkeleton label="Loading results…" />
      </LocaleProvider>,
    );

    const statuses = screen.getAllByRole("status");
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveTextContent("Loading results…");
    expect(container.querySelector(".animate-spin")).toHaveAttribute("aria-hidden", "true");
  });
});
