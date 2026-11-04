/**
 * Exports: the converted `.ork` files of a rocket.
 *
 * The API numbers the imports of one file name within a rocket by import date
 * (`ork_revision`, apps/api routers/exports.py); a file imported once has
 * none. `fileLabel` is the text form ("MT1-v1.6.0.ork v3") for places that
 * render plain strings: the top bar, legends, diffs and the PDF. Lists and
 * tables render the same pair with `FileName` (components/ui), whose version
 * is a pill.
 */

export function fileLabel(
  filename: string | null | undefined,
  revision: number | null | undefined,
  fallback = "",
): string {
  if (!filename) return fallback;
  return typeof revision === "number" ? `${filename} v${revision}` : filename;
}
