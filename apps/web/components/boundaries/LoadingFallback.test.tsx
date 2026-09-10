import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoadingFallback } from "./LoadingFallback";

describe("LoadingFallback", () => {
  it("renders the given label alongside the spinner", () => {
    render(<LoadingFallback label="Loading results…" />);

    expect(screen.getByText("Loading results…")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
