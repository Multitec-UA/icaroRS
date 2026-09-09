import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ErrorFallback } from "./ErrorFallback";

describe("ErrorFallback", () => {
  it("renders the title and message", () => {
    render(
      <ErrorFallback
        title="Something went wrong"
        message="An unexpected error occurred. You can try again."
        retry={{ label: "Try again", onClick: vi.fn() }}
      />,
    );

    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(
      screen.getByText("An unexpected error occurred. You can try again."),
    ).toBeInTheDocument();
  });

  it("wires the retry action to its button", () => {
    const onClick = vi.fn();
    render(
      <ErrorFallback
        title="Something went wrong"
        message="An unexpected error occurred."
        retry={{ label: "Try again", onClick }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders and wires an optional secondary action", () => {
    const onRetry = vi.fn();
    const onSecondary = vi.fn();
    render(
      <ErrorFallback
        title="Something went wrong"
        message="An unexpected error occurred."
        retry={{ label: "Try again", onClick: onRetry }}
        secondaryAction={{ label: "Back to start", onClick: onSecondary }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Back to start" }));

    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("omits the secondary action when not provided", () => {
    render(
      <ErrorFallback
        title="Something went wrong"
        message="An unexpected error occurred."
        retry={{ label: "Try again", onClick: vi.fn() }}
      />,
    );

    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
