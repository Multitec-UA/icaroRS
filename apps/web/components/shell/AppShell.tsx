"use client";

/**
 * AppShell — one navigation for every authenticated route (S9/T8b). The
 * Workbench's sidebar (brand, Workbench · Rockets · Runs, theme toggle and
 * account menu) used to live inside WorkbenchShell at `/` while the other
 * routes had their own floating nav (AppNav). AuthGate now renders this
 * shell around `<main id="main">` for every signed-in route, so /rockets,
 * /runs and /results/* share the same sidebar and the same active-item and
 * skip-link behaviour. Pages own only their own content.
 *
 * It also mounts the one Toaster (S8): a run that finishes after the user
 * left the Workbench announces itself on whatever route they are on.
 */

import type { ReactNode } from "react";
import { Sidebar } from "@/components/workbench/Sidebar";
import { Toaster } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";

export function AppShell({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="flex w-full flex-1 flex-col lg:flex-row">
      <Sidebar />
      <main id="main" className="flex min-w-0 flex-1 flex-col">
        {children}
      </main>
      <Toaster dismissLabel={t("workbench.toastDismiss")} />
    </div>
  );
}
