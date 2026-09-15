// Fixture: a `.ts` file (no JSX) exporting metadata — valid Next.js, and a
// hole in the scan until the walker stopped being .tsx-only.
//
// The angle-bracket type assertion below is the point of the file: it is
// legal TypeScript, but parsed as TSX it reads as an unclosed JSX element
// that swallows everything after it, so the metadata leak would go
// unreported. It pins scanFile()'s ScriptKind branch.
const appName = <string>(globalThis as { name?: unknown }).name;

export const metadata = {
  title: "Planted metadata leak in a .ts file",
  applicationName: appName,
};
