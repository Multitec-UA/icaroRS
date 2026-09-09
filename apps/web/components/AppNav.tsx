"use client";

/**
 * AppNav — shared app-level navigation rendered on all authenticated pages.
 *
 * Layout: two visually distinct clusters.
 *   1. Primary island: a floating glass pill (sticky, centered) with the three
 *      destinations: Simulate (/) · Rockets (/rockets) · History (/history).
 *      Active route gets an elevated filled indicator; inactive links are muted.
 *   2. Utility bar: LanguageSwitch + Sign out, placed top-right. These are NOT
 *      primary navigation and must never look like they are.
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

import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/components/auth/AuthGate";
import { useWizardNav } from "@/components/wizard/WizardProvider";
import { LanguageSwitch } from "@/components/LanguageSwitch";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn } from "@/components/ui";

interface NavItem {
  key: "simulate" | "rockets" | "history";
  href: string;
  label: string;
}

export function AppNav() {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const { logout } = useAuth();
  // Nav-only (issue #50) — see Stepper.tsx for why this matters.
  const { reset } = useWizardNav();

  function handleNav(href: string) {
    // Leaving the results screen ends the current run — clear the wizard form so
    // returning to the wizard lands on the initial .ork upload step rather than
    // the spent run's state.
    if (pathname.startsWith("/results")) reset();
    router.push(href);
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

  return (
    <div className="sticky top-0 z-40 flex items-start justify-center px-4 pt-5 pb-2">
      {/* Backdrop blur layer — valid because this is a sticky element */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 backdrop-blur-md [mask-image:linear-gradient(to_bottom,black_70%,transparent)]"
      />

      {/* Primary island: floating glass pill */}
      <nav
        aria-label="Primary navigation"
        className="flex items-center gap-0.5 rounded-full bg-white/[0.04] p-1 ring-1 ring-inset ring-white/10 shadow-[0_4px_32px_rgba(0,0,0,0.5)]"
      >
        {items.map(({ href, label }) => {
          const active = isActive(href);
          return (
            <button
              key={href}
              type="button"
              onClick={() => handleNav(href)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative rounded-full px-4 py-1.5 text-sm font-medium transition-all duration-500 ease-[var(--ease-spring)] active:scale-[0.98]",
                active
                  ? "bg-white/[0.12] text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)] ring-1 ring-inset ring-white/15"
                  : "text-muted hover:text-foreground",
              )}
            >
              {label}
            </button>
          );
        })}
      </nav>

      {/* Utility cluster: language + sign out — visually distinct, top-right */}
      <div className="absolute right-4 top-5 flex items-center gap-2">
        <LanguageSwitch />
        <button
          type="button"
          onClick={logout}
          className="rounded-full px-3 py-1.5 text-xs text-muted ring-1 ring-inset ring-white/10 transition-colors duration-300 ease-[var(--ease-spring)] hover:text-foreground hover:ring-white/20 active:scale-[0.98]"
        >
          {t("nav.signOut")}
        </button>
      </div>
    </div>
  );
}
