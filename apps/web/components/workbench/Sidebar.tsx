"use client";

/**
 * Sidebar — the app's navigation column (S7, every route since T8b): brand
 * mark, the three destinations (Workbench · Rockets · Runs), then the theme
 * toggle and the account menu pinned to the bottom. On small screens it
 * collapses to a wrapping top row so nothing scrolls sideways at phone widths.
 *
 * Destinations are real links (Cmd/Ctrl-click, middle-click and "open in new
 * tab" keep working); the active one carries `aria-current="page"`. Leaving
 * the run report through one of them ends that run for the Workbench: the
 * draft is reset so `/` starts clean rather than on the spent run's state.
 */

import type { MouseEvent } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWizardNav } from "@/components/wizard/WizardProvider";
import { AccountMenu } from "@/components/auth/AccountMenu";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";
import { RocketIcon, RunsIcon, WorkbenchIcon } from "./icons";

interface NavItem {
  href: string;
  label: string;
  Icon: typeof WorkbenchIcon;
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/" || pathname === "";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar() {
  const t = useT();
  const pathname = usePathname();
  // Nav-only slice: this never re-renders on draft keystrokes.
  const { reset } = useWizardNav();

  function handleNav(event: MouseEvent<HTMLAnchorElement>) {
    // A modified click (new tab/window) leaves this tab on the report, so
    // the draft must survive; onClick still fires for those, hence the guard.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    if (pathname.startsWith("/results")) reset();
  }

  const items: NavItem[] = [
    { href: "/", label: t("workbench.navWorkbench"), Icon: WorkbenchIcon },
    { href: "/rockets", label: t("workbench.navRockets"), Icon: RocketIcon },
    { href: "/runs", label: t("workbench.navRuns"), Icon: RunsIcon },
  ];

  return (
    <aside className="relative z-20 flex flex-wrap items-center gap-1 px-3 pt-3 lg:sticky lg:top-0 lg:h-dvh lg:w-[232px] lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:py-4">
      <div className="flex items-center gap-2.5 px-2 pb-0 lg:pb-4">
        <span
          aria-hidden
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-primary text-on-primary"
        >
          <RocketIcon />
        </span>
        <strong className="text-[15px] font-semibold text-ink">{t("workbench.brand")}</strong>
      </div>

      <nav aria-label={t("nav.primaryNavigation")} className="flex flex-wrap items-center gap-1 lg:flex-col lg:items-stretch">
        {items.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              onClick={handleNav}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-[9px] px-2.5 text-sm transition-[background-color,color,box-shadow,transform] duration-300 ease-[var(--ease-spring)] active:scale-[0.98]",
                focusRing,
                active ? "bg-surface font-medium text-ink shadow-soft" : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="hidden flex-1 lg:block" />

      <div className="ml-auto flex items-center gap-1 lg:ml-0 lg:flex-col lg:items-stretch">
        <div className="flex h-9 items-center justify-between gap-2.5 rounded-[9px] px-2.5">
          <span className="hidden text-sm text-ink-2 lg:inline">{t("theme.label")}</span>
          <ThemeToggle />
        </div>
        {/* The account panel positions itself below-right of its avatar. At
            the bottom of a sticky sidebar that would open off-screen, so on
            large screens its panel is flipped to open up and to the right. */}
        <div className="flex h-11 items-center px-2 lg:[&>div>div]:bottom-11 lg:[&>div>div]:left-0 lg:[&>div>div]:right-auto lg:[&>div>div]:top-auto">
          <AccountMenu />
        </div>
      </div>
    </aside>
  );
}
