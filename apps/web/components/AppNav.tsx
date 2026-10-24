"use client";

/**
 * AppNav — shared app-level navigation rendered on the authenticated pages
 * that have no navigation of their own. The Workbench at `/` ships its own
 * sidebar (components/workbench/Sidebar.tsx), so this renders nothing there
 * and keeps serving /rockets, /history and /results/*.
 *
 * Layout: two visually distinct clusters.
 *   1. Primary island: a floating glass pill (sticky, centered) with the three
 *      destinations: Simulate (/) · Rockets (/rockets) · History (/history).
 *      Active route gets an elevated filled indicator; inactive links are muted.
 *   2. Account: the round avatar (AccountMenu), placed top-right. Its panel
 *      holds the user's email and organization, the language switch, "Change
 *      password" and "Sign out". It is NOT primary navigation and must never
 *      look like it is.
 *
 * Design rules observed (Ethereal Glass / Fluid Island Nav):
 * - backdrop-blur ONLY because the nav is sticky (fixed/sticky layer rule).
 * - All transitions use --ease-spring cubic-bezier(0.32,0.72,0,1) via the
 *   `ease-[var(--ease-spring)]` Tailwind utility.
 * - Animate ONLY transform/opacity. Press feedback: active:scale-[0.98].
 * - Font: Geist (inherited from <html>). No Inter/Arial/Roboto.
 * - Mobile: island collapses to full-width centered pills at sm: breakpoint —
 *   no overflow, no hamburger complexity, stays premium on touch.
 */

import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWizardNav } from "@/components/wizard/WizardProvider";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";

interface NavItem {
  key: "simulate" | "rockets" | "history";
  href: string;
  label: string;
}

export function AppNav() {
  const t = useT();
  const pathname = usePathname();
  // Nav-only (issue #50) — see Stepper.tsx for why this matters.
  const { reset } = useWizardNav();

  function handleNav(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click (new tab/window) leaves this tab on the results screen,
    // so the draft must survive; onClick still fires for those, hence the guard.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    // Leaving the results screen ends the current run — clear the wizard form so
    // returning to the wizard lands on the initial .ork upload step rather than
    // the spent run's state. The Link itself does the navigation.
    if (pathname.startsWith("/results")) reset();
  }

  const items: NavItem[] = [
    { key: "simulate", href: "/", label: t("nav.simulate") },
    { key: "rockets", href: "/rockets", label: t("nav.rockets") },
    { key: "history", href: "/history", label: t("nav.history") },
  ];

  function isActive(href: string) {
    if (href === "/") return pathname === "/" || pathname === "";
    return pathname === href || pathname.startsWith(href + "/");
  }

  // The Workbench owns the whole viewport at `/`, sidebar included.
  if (pathname === "/" || pathname === "") return null;

  return (
    <div className="sticky top-0 z-40 flex items-start justify-center px-4 pt-5 pb-2">
      {/* Backdrop blur layer — valid because this is a sticky element */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
      />

      {/* Primary island: floating glass pill */}
      <nav
        aria-label={t("nav.primaryNavigation")}
        className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-1 ring-1 ring-inset ring-white/10 shadow-[0_4px_32px_rgba(0,0,0,0.5)]"
      >
        {items.map(({ href, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={handleNav}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative rounded-full px-4 py-1.5 text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-500 ease-[var(--ease-spring)] active:scale-[0.98]",
                focusRing,
                active
                  ? "bg-white/[0.12] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-inset ring-white/15"
                  : "text-muted hover:text-foreground",
              )}
            >
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Account: avatar + its panel — visually distinct, top-right */}
      <div className="absolute right-4 top-5">
        <AccountMenu />
      </div>
    </div>
  );
}
