import { ResultsDashboard } from "@/components/results/ResultsDashboard";

// Next 16: dynamic route params are async — await before use.
export default async function ResultsPage({
  params,
}: {
  params: Promise<{ runId: string }>;
}) {
  const { runId } = await params;
  return <ResultsDashboard runId={runId} />;
}
