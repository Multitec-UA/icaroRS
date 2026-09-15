// Fixture: hardcoded copy in an exported Next.js `metadata` object (issue
// #103). None of this is JSX, so it proves rule 3 catches what rules 1 and 2
// structurally cannot — every member of METADATA_COPY_FIELDS, including the
// nested `openGraph.*` and `title.default` forms, while leaving machine
// values like metadataBase alone.
export const metadata = {
  title: {
    default: "Planted metadata title leak",
    template: "%s",
  },
  description: "Planted metadata description leak",
  applicationName: "Planted applicationName leak",
  metadataBase: "https://example.invalid",
  openGraph: {
    title: "Planted openGraph title leak",
    siteName: "Planted siteName leak",
  },
};

// The function form too — this is the shape app/layout.tsx uses. Without it,
// metadataRootsIn()'s function-declaration branch could be deleted with every
// test still passing, leaving the guard that protects app/layout.tsx unproved
// for the shape it actually has.
export async function generateMetadata() {
  return {
    title: "Planted generateMetadata title leak",
  };
}
