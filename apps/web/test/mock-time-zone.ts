import { vi } from "vitest";

/**
 * Make the browser report `timeZone` as its own zone, as read by
 * `Intl.DateTimeFormat().resolvedOptions().timeZone`. Every other
 * `Intl.DateTimeFormat` call keeps its real behavior. Undo with
 * `vi.restoreAllMocks()`.
 */
export function mockBrowserTimeZone(timeZone: string | undefined): void {
  const real = Intl.DateTimeFormat;
  // A plain function (not an arrow) so the mock still works when called with `new`.
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (
    locales?: string | string[],
    options?: Intl.DateTimeFormatOptions,
  ) {
    const formatter = new real(locales, options);
    if (locales === undefined && options === undefined) {
      const resolved = formatter.resolvedOptions();
      formatter.resolvedOptions = () => ({ ...resolved, timeZone: timeZone as string });
    }
    return formatter;
  } as unknown as typeof Intl.DateTimeFormat);
}
