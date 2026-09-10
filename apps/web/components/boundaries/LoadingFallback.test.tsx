import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { LoadingFallback } from "./LoadingFallback";

// LoadingFallback always renders inside LocaleProvider in the real app (it's
// nested under the root layout, same as every other route boundary), and
// since issue #54 its Spinner child resolves an aria-label via useT() — so
// the test needs the same context, not a bare render.
describe("LoadingFallback", () => {
  it("renders the given label alongside the spinner", () => {
    render(
      <LocaleProvider initialLocale="en">
        <LoadingFallback label="Loading results…" />
      </LocaleProvider>,
    );

    expect(screen.getByText("Loading results…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
