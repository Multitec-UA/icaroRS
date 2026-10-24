"use client";

/**
 * DestinationCard — "Where does this file go?" (S8/A2, L3/L14). Shown after
 * a file is chosen and before the upload starts, because `rocket_id` travels
 * in the convert request. "New rocket" is the default; "Add to one of my
 * rockets" needs an explicit pick from the org's list. Nothing is inferred
 * from the file name — the user decides on purpose.
 */

import { useId, useState } from "react";
import type { RocketSummary } from "@/lib/api";
import { useT } from "@/components/i18n/LocaleProvider";
import { Reveal } from "@/components/motion";
import { cn, selectClass } from "@/lib/styles";
import { ghostButton, primaryButton } from "./styles";

type Destination = "new" | "existing";

export function DestinationCard({
  file,
  rockets,
  loadingRockets,
  onConvert,
  onCancel,
}: {
  file: File;
  rockets: RocketSummary[];
  loadingRockets: boolean;
  onConvert: (rocketId: string | null) => void;
  onCancel: () => void;
}) {
  const t = useT();
  const titleId = useId();
  const [destination, setDestination] = useState<Destination>("new");
  const [rocketId, setRocketId] = useState("");

  const canConvert = destination === "new" || rocketId !== "";

  const optionClass =
    "flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-surface px-3 py-3 transition-[border-color,background-color] duration-300 ease-[var(--ease-spring)] has-[:checked]:border-accent has-[:checked]:bg-accent-soft/40";
  const radioClass = "mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent)]";

  return (
    <Reveal>
      <section
        aria-labelledby={titleId}
        className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-soft sm:p-5"
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id={titleId} className="text-base font-semibold text-ink">
            {t("workbench.destTitle")}
          </h2>
          <code className="truncate font-mono text-xs text-ink-2">{file.name}</code>
        </div>
        <p className="text-sm text-ink-2">{t("workbench.destIntro")}</p>

        <div role="radiogroup" aria-label={t("workbench.destGroupLabel")} className="flex flex-col gap-2">
          <label className={optionClass}>
            <input
              type="radio"
              name="destination"
              value="new"
              checked={destination === "new"}
              onChange={() => setDestination("new")}
              className={radioClass}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">{t("workbench.destNew")}</span>
              <span className="text-xs text-muted">{t("workbench.destNewHint")}</span>
            </span>
          </label>

          <label className={optionClass}>
            <input
              type="radio"
              name="destination"
              value="existing"
              checked={destination === "existing"}
              onChange={() => setDestination("existing")}
              className={radioClass}
            />
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium text-ink">{t("workbench.destExisting")}</span>
              <span className="text-xs text-muted">{t("workbench.destExistingHint")}</span>
            </span>
          </label>
        </div>

        <select
          name="destination-rocket"
          aria-label={t("workbench.destSelectLabel")}
          disabled={destination !== "existing"}
          value={rocketId}
          onChange={(event) => setRocketId(event.target.value)}
          className={cn(selectClass, "h-10 disabled:opacity-50")}
        >
          <option value="">{loadingRockets ? t("rockets.loading") : t("workbench.destChoose")}</option>
          {rockets.map((rocket) => (
            <option key={rocket.rocket_id} value={rocket.rocket_id}>
              {rocket.name}
            </option>
          ))}
        </select>

        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onCancel} className={ghostButton}>
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!canConvert}
            onClick={() => onConvert(destination === "new" ? null : rocketId)}
            className={primaryButton}
          >
            {t("workbench.destConvert")}
          </button>
        </div>
      </section>
    </Reveal>
  );
}
