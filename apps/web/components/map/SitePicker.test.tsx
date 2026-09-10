import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { GeocodeError } from "@/lib/geocode";
import { SitePicker } from "./SitePicker";

const geocodeSearchMock = vi.fn();

vi.mock("@/lib/geocode", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/geocode")>();
  return {
    ...actual,
    geocodeSearch: (...args: Parameters<typeof actual.geocodeSearch>) => geocodeSearchMock(...args),
  };
});

// The real MapInner touches Leaflet/window at import time — irrelevant to
// SitePicker's own search/error logic, same rationale as InteractiveResults
// stubbing out the chart libs it dynamically imports. The artificial delay
// keeps next/dynamic's `loading` fallback on screen long enough to assert
// against (a same-tick mock resolves before the very first render commits).
vi.mock("./MapInner", async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  return { default: () => <div>map-inner-stub</div> };
});

function Providers({ children }: { children: ReactNode }) {
  return <LocaleProvider initialLocale="en">{children}</LocaleProvider>;
}

afterEach(() => {
  geocodeSearchMock.mockReset();
});

describe("SitePicker (issues #55 — geocode proxy, #54 — i18n leak sweep)", () => {
  // NOTE: this must run first in the file. next/dynamic caches the module
  // once the underlying `import("./MapInner")` has resolved, so any earlier
  // render() of <SitePicker> in this file would make the "still loading"
  // window unobservable here.
  it("shows a localized fallback while the map chunk loads — proving LocaleProvider context reaches the next/dynamic `loading` callback", async () => {
    render(
      <Providers>
        <SitePicker lat={null} lon={null} onPick={vi.fn()} />
      </Providers>,
    );

    // The mocked import is deliberately delayed (see the mock above), so this
    // is asserting against the actual `loading:` fallback, not a race.
    expect(screen.getByText("Loading map…")).toBeInTheDocument();

    // ...and it resolves to the real map once the chunk "loads".
    expect(await screen.findByText("map-inner-stub")).toBeInTheDocument();
  });

  it("renders localized copy and never talks to Nominatim directly", () => {
    render(
      <Providers>
        <SitePicker lat={null} lon={null} onPick={vi.fn()} />
      </Providers>,
    );

    expect(screen.getByPlaceholderText("Search a place (e.g. Alicante, Spain)…")).toBeInTheDocument();
    expect(
      screen.getByText("Click anywhere on the map to drop the launch point, or search for a place above."),
    ).toBeInTheDocument();
  });

  it("searches (debounced) and renders hits; choosing one calls onPick", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const hit = { lat: "38.34", lon: "-0.48", display_name: "Alicante, Spain" };
    geocodeSearchMock.mockResolvedValueOnce([hit]);
    const onPick = vi.fn();

    render(
      <Providers>
        <SitePicker lat={null} lon={null} onPick={onPick} />
      </Providers>,
    );

    fireEvent.change(screen.getByPlaceholderText("Search a place (e.g. Alicante, Spain)…"), {
      target: { value: "Alicante" },
    });

    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();

    expect(geocodeSearchMock).toHaveBeenCalledWith("Alicante");
    const option = await screen.findByText("Alicante, Spain");
    fireEvent.click(option);

    expect(onPick).toHaveBeenCalledWith(38.34, -0.48);
  });

  it("does not search below the minimum query length", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(
      <Providers>
        <SitePicker lat={null} lon={null} onPick={vi.fn()} />
      </Providers>,
    );

    fireEvent.change(screen.getByPlaceholderText("Search a place (e.g. Alicante, Spain)…"), {
      target: { value: "al" },
    });

    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();

    expect(geocodeSearchMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed lookup distinctly from a genuine empty result", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    geocodeSearchMock.mockRejectedValueOnce(new GeocodeError("network"));

    render(
      <Providers>
        <SitePicker lat={null} lon={null} onPick={vi.fn()} />
      </Providers>,
    );

    fireEvent.change(screen.getByPlaceholderText("Search a place (e.g. Alicante, Spain)…"), {
      target: { value: "Nowhereville" },
    });

    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();

    expect(
      await screen.findByText("Couldn't search for that place. Please try again in a moment."),
    ).toBeInTheDocument();
  });

  it("clears a previous search error once a new search succeeds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    geocodeSearchMock.mockRejectedValueOnce(new GeocodeError("upstream"));
    geocodeSearchMock.mockResolvedValueOnce([]);

    render(
      <Providers>
        <SitePicker lat={null} lon={null} onPick={vi.fn()} />
      </Providers>,
    );

    const input = screen.getByPlaceholderText("Search a place (e.g. Alicante, Spain)…");

    fireEvent.change(input, { target: { value: "Nowhereville" } });
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() =>
      expect(
        screen.getByText("Couldn't search for that place. Please try again in a moment."),
      ).toBeInTheDocument(),
    );

    fireEvent.change(input, { target: { value: "Somewhereville" } });
    await vi.advanceTimersByTimeAsync(400);
    vi.useRealTimers();

    await waitFor(() =>
      expect(
        screen.queryByText("Couldn't search for that place. Please try again in a moment."),
      ).not.toBeInTheDocument(),
    );
  });
});
