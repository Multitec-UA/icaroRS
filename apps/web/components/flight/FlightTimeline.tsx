"use client";

/**
 * FlightTimeline — the run's events in time order (S9): leaves rail, max
 * acceleration, max speed, apogee, landing — only those whose time the
 * scalars actually carry. With a replay registered (ReplayContext) each row
 * is a button that seeks the replay to that second; otherwise the rows are
 * plain. Rows stagger in with Reveal.
 */

import { useId } from "react";
import { Reveal } from "@/components/motion";
import { cn, focusRing } from "@/lib/styles";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { flightEvents, formatQuantity, formatSeconds } from "./flightMath";
import { useReplaySeek } from "./ReplayContext";

const ROW_CLASS = "flex w-full items-baseline gap-3 py-2 text-sm";

export function FlightTimeline({ scalars }: { scalars: Record<string, number | null> }) {
  const t = useT();
  const { locale } = useLocale();
  const id = useId();
  const { hasReplay, seek } = useReplaySeek();
  const events = flightEvents(scalars);

  if (events.length === 0) return null;

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="rounded-2xl border border-border bg-surface shadow-soft"
    >
      <h3 id={`${id}-title`} className="px-4 pb-1 pt-3.5 text-sm font-semibold text-ink">
        {t("flight.timelineTitle")}
      </h3>
      <ol aria-labelledby={`${id}-title`} className="flex flex-col px-4 pb-2">
        {events.map((event, i) => {
          const time = formatSeconds(event.time, locale);
          const label = t(event.labelKey);
          const value = event.value ? formatQuantity(event.value.amount, event.value.unit, locale) : "";
          const cells = (
            <>
              <span className="tabular-readout w-16 shrink-0 text-left text-muted">{time}</span>
              <span className="min-w-0 flex-1 truncate text-left">{label}</span>
              <span className="tabular-readout shrink-0 text-ink-2">{value}</span>
            </>
          );
          return (
            <li key={event.key} className="border-t border-divider first:border-t-0">
              <Reveal delay={0.26 + i * 0.05}>
                {hasReplay ? (
                  <button
                    type="button"
                    aria-label={t("flight.seekTo", { event: label, time })}
                    onClick={() => seek(event.time)}
                    className={cn(
                      ROW_CLASS,
                      focusRing,
                      "-mx-2.5 w-[calc(100%+1.25rem)] rounded-lg px-2.5 text-ink transition-[background-color,color] duration-300 ease-[var(--ease-spring)] hover:bg-accent-soft hover:text-accent-ink",
                    )}
                  >
                    {cells}
                  </button>
                ) : (
                  <div className={cn(ROW_CLASS, "text-ink")}>{cells}</div>
                )}
              </Reveal>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
