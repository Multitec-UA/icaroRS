// Fixture: metadata copy routed through t() inside generateMetadata — the
// correct shape (see app/layout.tsx). The scanner must not flag anything
// here, including the non-copy `metadataBase` configuration value.
declare function t(key: string): string;

export async function generateMetadata() {
  return {
    title: t("meta.title"),
    description: t("meta.description"),
    metadataBase: "https://example.invalid",
  };
}
