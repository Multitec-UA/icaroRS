"use client";

/** The launch-day advisor card, wired to the Workbench draft (launch-day S6b). */

import { LaunchDayCard } from "@/components/results/LaunchDayCard";
import { useLaunchDay } from "./useLaunchDay";

export function LaunchDayPanel() {
  return <LaunchDayCard {...useLaunchDay()} />;
}
