"use client";

/**
 * Sidebar — the app's navigation column (S7, every route since T8b): brand
 * mark, the three destinations (Workbench · Rockets · Runs), then the theme
 * toggle and the account menu pinned to the bottom.
 *
 * Below `lg` (S10) the same element becomes a bottom bar fixed to the
 * viewport: Workbench · Rockets · Runs · account, each a 44 px target, with
 * `env(safe-area-inset-bottom)` padding. The brand and the separate theme
 * row are hidden there; the account menu (which carries the theme and
 * language switches) opens upwards. AppShell pads `<main>` by the bar's
 * height so no content hides under it. One DOM for both layouts keeps one
 * account menu and one set of links.
 *
 * Destinations are real links (Cmd/Ctrl-click, middle-click and "open in new
 * tab" keep working); the active one carries `aria-current="page"`. They
 * never touch the draft (S8): the Workbench keeps it in memory and mirrors
 * it into its URL, so coming back to `/` shows the same file, scenario and
 * run.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
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

  const items: NavItem[] = [
    { href: "/", label: t("workbench.navWorkbench"), Icon: WorkbenchIcon },
    { href: "/rockets", label: t("workbench.navRockets"), Icon: RocketIcon },
    { href: "/runs", label: t("workbench.navRuns"), Icon: RunsIcon },
  ];

  return (
    <aside className="z-30 flex items-center gap-1 max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:border-t max-lg:border-border max-lg:bg-surface max-lg:px-2 max-lg:pb-[env(safe-area-inset-bottom)] max-lg:shadow-soft-lg lg:sticky lg:top-0 lg:z-20 lg:h-dvh lg:w-[232px] lg:shrink-0 lg:flex-col lg:items-stretch lg:px-3 lg:py-4">
      <div className="flex items-center gap-2.5 px-2 pb-4 max-lg:hidden">
        <span
          aria-hidden
          className="flex h-[30px] w-[30px] items-center justify-center rounded-[9px] bg-primary text-on-primary"
        >
          <RocketIcon />
        </span>
        <strong className="text-[15px] font-semibold text-ink">{t("workbench.brand")}</strong>
      </div>

      <nav aria-label={t("nav.primaryNavigation")} className="flex flex-1 items-stretch gap-1 lg:flex-none lg:flex-col">
        {items.map(({ href, label, Icon }) => {
          const active = isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center rounded-[9px] transition-[background-color,color,box-shadow,transform] duration-300 ease-[var(--ease-spring)] active:scale-[0.98]",
                "max-lg:my-1 max-lg:min-h-11 max-lg:flex-1 max-lg:flex-col max-lg:justify-center max-lg:gap-0.5 max-lg:text-[11px]",
                "lg:h-9 lg:gap-2.5 lg:px-2.5 lg:text-sm",
                focusRing,
                active
                  ? "font-medium text-ink lg:bg-surface lg:shadow-soft max-lg:bg-surface-2"
                  : "text-ink-2 hover:bg-surface-2 hover:text-ink",
              )}
            >
              <Icon className="shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="hidden flex-1 lg:block" />

      <div className="flex items-center gap-1 lg:flex-col lg:items-stretch">
        <div className="flex h-9 items-center justify-between gap-2.5 rounded-[9px] px-2.5 max-lg:hidden">
          <span className="hidden text-sm text-ink-2 lg:inline">{t("theme.label")}</span>
          <ThemeToggle />
        </div>
        {/* The account panel positions itself below-right of its avatar. At
            the bottom of a sticky sidebar, or in the bottom bar, that would
            open off-screen, so it is flipped to open upwards (and to the
            right on large screens). */}
        <div className="flex h-11 items-center px-2 [&>div>div]:bottom-11 [&>div>div]:top-auto lg:[&>div>div]:left-0 lg:[&>div>div]:right-auto">
          <AccountMenu />
        </div>
      </div>
    </aside>
  );
}
