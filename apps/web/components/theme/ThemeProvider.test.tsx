import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./ThemeProvider";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPreference("system")}>system</button>
    </div>
  );
}

let listeners: Array<(e: { matches: boolean }) => void> = [];
let prefersDark = false;

beforeEach(() => {
  listeners = [];
  prefersDark = false;
  document.cookie = "icaro-theme=; max-age=0; path=/";
  delete document.documentElement.dataset.theme;
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("dark") ? prefersDark : !prefersDark,
      media: query,
      addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.push(cb),
      removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => {
        listeners = listeners.filter((l) => l !== cb);
      },
    })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderWith(initial: "light" | "dark" | "system") {
  return render(
    <LocaleProvider initialLocale="en">
      <ThemeProvider initialPreference={initial}>
        <Probe />
        <ThemeToggle />
      </ThemeProvider>
    </LocaleProvider>,
  );
}

describe("ThemeProvider", () => {
  it("follows the OS when the preference is system, and tracks changes", () => {
    prefersDark = true;
    renderWith("system");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.dataset.theme).toBeUndefined();

    act(() => {
      prefersDark = false;
      listeners.forEach((l) => l({ matches: false }));
    });
    expect(screen.getByTestId("resolved").textContent).toBe("light");
  });

  it("an explicit preference wins over the OS and is reflected on <html>", () => {
    prefersDark = true;
    renderWith("light");
    expect(screen.getByTestId("resolved").textContent).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    // The cookie is the server's input here, not this render's output: it is
    // written only when the user changes the preference (see the toggle test).
    expect(document.cookie).not.toContain("icaro-theme=");
  });

  it("the toggle flips to the opposite of what is shown and announces the next mode", () => {
    renderWith("light");
    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);

    expect(screen.getByTestId("preference").textContent).toBe("dark");
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.cookie).toContain("icaro-theme=dark");
    expect(screen.getByRole("button", { name: "Switch to light mode" })).toHaveAttribute("aria-pressed", "true");
  });

  it("going back to system clears the <html> attribute and the cookie", () => {
    renderWith("dark");
    fireEvent.click(screen.getByText("system"));
    expect(document.documentElement.dataset.theme).toBeUndefined();
    expect(document.cookie).not.toContain("icaro-theme=dark");
  });
});
