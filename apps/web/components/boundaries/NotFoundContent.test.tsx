import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { NotFoundContent } from "./NotFoundContent";

describe("NotFoundContent", () => {
  it("renders the title and message", () => {
    render(
      <NotFoundContent
        title="Page not found"
        message="We couldn't find what you were looking for."
        backLabel="Back home"
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Page not found" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't find what you were looking for."),
    ).toBeInTheDocument();
  });

  it("links back to the home route", () => {
    render(
      <NotFoundContent
        title="Page not found"
        message="We couldn't find what you were looking for."
        backLabel="Back home"
      />,
    );

    const link = screen.getByRole("link", { name: "Back home" });
    expect(link).toHaveAttribute("href", "/");
  });
});
