"use client";

/**
 * PlotGallery — the static PNG plots of a run, always available (S7: the
 * "Plots" disclosure of RunResults). Titles come from the `plots.*` catalog
 * by the file stem, humanised when the stem is unknown. `bare` drops the
 * gallery's own heading when its container already names it.
 */

import { useId } from "react";
import { PlotCard } from "@/components/results/PlotCard";
import { useT } from "@/components/i18n/LocaleProvider";

export function PlotGallery({ urls, bare = false }: { urls: string[]; bare?: boolean }) {
  const t = useT();
  const id = useId();
  if (urls.length === 0) return null;

  const grid = (
    <div className="grid gap-4 sm:grid-cols-2">
      {urls.map((url, index) => {
        const stem = url.split("/").pop()?.replace(/\.png$/, "") ?? "plot";
        const key = `plots.${stem}`;
        const title = t(key) !== key ? t(key) : stem.replace(/_/g, " ");
        return (
          <PlotCard key={url} url={url} title={title} failedLabel={t("results.couldNotLoadPlot")} index={index} />
        );
      })}
    </div>
  );
  if (bare) return grid;

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-sm font-semibold text-ink">
        {t("flight.plotsTitle")}
      </h3>
      {grid}
    </section>
  );
}
