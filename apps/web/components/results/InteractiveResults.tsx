"use client";

/**
 * InteractiveResults — the issue #11 interactive section of the results page.
 *
 * Fetches the flight time-series (GET /api/results/{run_id}/series) and renders
 * the animated 3D trajectory + the interactive 2D charts. If the series are
 * unavailable (404 — an old run, or extraction skipped), it renders nothing and
 * the dashboard's static PNG gallery remains the fallback.
 *
 * The heavy chart libs (three, echarts) are dynamically imported with ssr:false
 * so they stay out of SSR and are code-split off the initial bundle.
 */

import dynamic from "next/dynamic";
import { useSeriesQuery } from "@/lib/queries";
import { Eyebrow, Spinner, Surface } from "@/components/ui";
import { Reveal } from "@/components/motion";
import { useT } from "@/components/i18n/LocaleProvider";

function Trajectory3DLoadingFallback() {
  const t = useT();
  return (
    <div className="flex h-[440px] items-center justify-center text-muted">
      <Spinner /> <span className="ml-2">{t("interactive.loading3d")}</span>
    </div>
  );
}

const Trajectory3D = dynamic(
  () => import("@/components/charts/Trajectory3D").then((m) => m.Trajectory3D),
  {
    ssr: false,
    loading: Trajectory3DLoadingFallback,
  },
);

const SeriesChart = dynamic(
  () => import("@/components/charts/SeriesChart").then((m) => m.SeriesChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[360px] items-center justify-center text-muted">
        <Spinner />
      </div>
    ),
  },
);

export function InteractiveResults({ runId }: { runId: string }) {
  const t = useT();
  // A 401 logs the user out globally (lib/query-client.ts); any other error
  // (404 included, for a run that predates this feature) just leaves `series`
  // undefined and the PNG gallery stands in — same as before.
  const { data: series, isLoading: loading } = useSeriesQuery(runId);

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-muted">
        <Spinner /> {t("interactive.loadingFlightData")}
      </div>
    );
  }

  // No series → render nothing; the dashboard's PNG gallery is the fallback.
  if (!series) return null;

  const hasPath = Array.isArray(series.path3d) && series.path3d.length >= 2;

  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-muted">
        {t("interactive.sectionHeading")}
      </h2>

      {hasPath && (
        <Reveal>
          <Surface innerClassName="flex flex-col gap-5 p-5">
            <div className="flex items-center justify-between gap-3">
              <Eyebrow>{t("interactive.trajectoryEyebrow")}</Eyebrow>
              <span className="text-xs text-muted">{t("interactive.trajectoryHint")}</span>
            </div>
            <Trajectory3D path={series.path3d as [number, number, number][]} />
          </Surface>
        </Reveal>
      )}

      <Reveal delay={0.05}>
        <Surface innerClassName="flex flex-col gap-5 p-5">
          <Eyebrow>{t("interactive.telemetryEyebrow")}</Eyebrow>
          <SeriesChart series={series} />
        </Surface>
      </Reveal>
    </section>
  );
}
