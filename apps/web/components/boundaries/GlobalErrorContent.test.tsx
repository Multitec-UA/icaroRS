import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { GlobalErrorContent } from "./GlobalErrorContent";

describe("GlobalErrorContent", () => {
  it("renders the title and message", () => {
    render(
      <GlobalErrorContent
        title="Something went wrong"
        message="A critical error occurred and the application could not recover."
        retryLabel="Try again"
        onRetry={vi.fn()}
      />,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.getByText(
        "A critical error occurred and the application could not recover.",
      ),
    ).toBeInTheDocument();
  });

  it("wires the retry action to its button", () => {
    const onRetry = vi.fn();
    render(
      <GlobalErrorContent
        title="Something went wrong"
        message="A critical error occurred."
        retryLabel="Try again"
        onRetry={onRetry}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
