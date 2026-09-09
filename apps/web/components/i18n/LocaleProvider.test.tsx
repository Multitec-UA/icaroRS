import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { LocaleProvider, useLocale, useT } from "./LocaleProvider";

function Probe() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  return (
    <div>
      <span>{locale}</span>
      <span>{t("rockets.heading")}</span>
      <button onClick={() => setLocale("es")}>switch</button>
    </div>
  );
}

describe("LocaleProvider.setLocale (issue #52)", () => {
  it("calls router.refresh() so server-rendered text picks up the new NEXT_LOCALE cookie", () => {
    const refresh = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(),
      replace: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh,
      prefetch: vi.fn(),
    });

    render(
      <LocaleProvider initialLocale="en">
        <Probe />
      </LocaleProvider>,
    );

    expect(screen.getByText("Your rockets")).toBeInTheDocument();

    fireEvent.click(screen.getByText("switch"));

    expect(screen.getByText("es")).toBeInTheDocument();
    expect(screen.getByText("Tus cohetes")).toBeInTheDocument();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
