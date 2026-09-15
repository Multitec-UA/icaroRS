// Fixture: `title` and `description` properties that are NOT route metadata.
// Rule 3 is scoped to the exported `metadata` / `generateMetadata` subtree
// precisely so ordinary configuration keeps its ordinary names — without that
// scoping this file would produce three false positives.
export const chartConfig = {
  title: "Not metadata — a chart option",
  description: "Not metadata — a chart option",
};

const metadata = {
  title: "Not exported, so not route metadata",
};

export function useChartConfig() {
  return { chartConfig, metadata };
}
