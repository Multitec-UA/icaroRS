import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Covers generateMetadata() (issue #103) — the document title and description
 * must come from the catalog for the locale the request resolves to, not from
 * hardcoded English. generateMetadata is a plain async function, so it can be
 * called directly; only the request APIs and the build-time font loader need
 * standing in for.
 */

const { cookiesMock, headersMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn(),
  headersMock: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: cookiesMock,
  headers: headersMock,
}));

// next/font/google is a build-time transform with no runtime implementation
// to call outside `next build`.
vi.mock("next/font/google", () => ({
  Geist: () => ({ variable: "--font-geist-sans" }),
  Geist_Mono: () => ({ variable: "--font-geist-mono" }),
}));

function mockRequest(options: { cookie?: string; acceptLanguage?: string } = {}) {
  cookiesMock.mockResolvedValue({
    get: (name: string) =>
      name === "NEXT_LOCALE" && options.cookie ? { value: options.cookie } : undefined,
  });
  headersMock.mockResolvedValue({
    // Name-aware on purpose: a stub that answers every header with the same
    // value would still pass if the code read the wrong header.
    get: (name: string) =>
      name.toLowerCase() === "accept-language" ? (options.acceptLanguage ?? null) : null,
  });
}

afterEach(() => {
  cookiesMock.mockReset();
  headersMock.mockReset();
});

describe("app/layout — generateMetadata", () => {
  it("returns English copy when nothing indicates a preference", async () => {
    mockRequest();

    const { generateMetadata } = await import("./layout");

    expect(await generateMetadata()).toEqual({
      title: "icaro · rocket simulation",
      description: "Run a rocket flight simulation from your OpenRocket design.",
    });
  });

  it("returns Spanish copy when the NEXT_LOCALE cookie says es", async () => {
    mockRequest({ cookie: "es" });

    const { generateMetadata } = await import("./layout");
    const metadata = await generateMetadata();

    expect(metadata.title).toBe("icaro · simulación de cohetes");
    expect(metadata.description).toBe(
      "Ejecuta una simulación de vuelo de cohete a partir de tu diseño de OpenRocket.",
    );
  });

  it("falls back to Accept-Language when no cookie has been set yet", async () => {
    mockRequest({ acceptLanguage: "es-ES,es;q=0.9,en;q=0.8" });

    const { generateMetadata } = await import("./layout");

    expect((await generateMetadata()).title).toBe("icaro · simulación de cohetes");
  });

  it("lets an explicit cookie win over Accept-Language", async () => {
    mockRequest({ cookie: "en", acceptLanguage: "es-ES,es;q=0.9" });

    const { generateMetadata } = await import("./layout");

    expect((await generateMetadata()).title).toBe("icaro · rocket simulation");
  });

  it("ignores an unsupported cookie value and every header that isn't Accept-Language", async () => {
    cookiesMock.mockResolvedValue({ get: () => ({ value: "fr" }) });
    headersMock.mockResolvedValue({ get: () => null });

    const { generateMetadata } = await import("./layout");

    expect((await generateMetadata()).title).toBe("icaro · rocket simulation");
  });
});
