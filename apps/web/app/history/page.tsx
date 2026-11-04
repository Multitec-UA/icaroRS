import { redirect } from "next/navigation";

/**
 * /history moved to /runs (S9): the runs table per rocket, with a baseline,
 * deltas and overlaid series, replaced the flat history list. Old links and
 * bookmarks land here, so this is a server redirect that keeps the query
 * string (the rocket filter among it) intact.
 */
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, item);
  }
  const qs = query.toString();
  redirect(qs ? `/runs?${qs}` : "/runs");
}
