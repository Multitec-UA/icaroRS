"use client";

/**
 * ResultsActions — "Simulate again" / "New rocket" (issue #52). A client
 * island: both drive the client-side WizardProvider (goto/reset are
 * nav-only — see WizardProvider.tsx's issue #50 context split) before
 * navigating back to the wizard root.
 *
 * "Simulate again" is a real <Link> (Cmd/Ctrl-click, middle-click and
 * "open in new tab" keep working) that moves the wizard to the basics step
 * on the way out. "New rocket" stays a button: it discards the draft before
 * navigating, which is a mutation, not a navigation.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWizardNav } from "@/components/wizard/WizardProvider";
import { Button } from "@/components/ui";
import { cn, focusRing } from "@/lib/styles";
import { useT } from "@/components/i18n/LocaleProvider";

// Matches components/ui.tsx's Button ghost variant (no `withArrow`) — Button
// only renders a <button>, so the link composes the same classes.
const ghostLinkClassName = cn(
  "group relative inline-flex h-12 items-center justify-center gap-2.5 rounded-full px-6 text-sm font-medium transition-[background-color,box-shadow,color,transform,opacity] duration-500 ease-[var(--ease-spring)] active:scale-[0.98] text-foreground ring-1 ring-inset ring-white/15 hover:bg-white/[0.06] hover:ring-white/25",
  focusRing,
);

export function ResultsActions() {
  const t = useT();
  const router = useRouter();
  const { goto, reset } = useWizardNav();

  function newRocket() {
    reset();
    router.push("/");
  }

  return (
    <div className="flex items-center gap-2">
      <Link href="/" onClick={() => goto("basics")} className={ghostLinkClassName}>
        <span className="inline-flex items-center gap-2.5">{t("results.simulateAgain")}</span>
      </Link>
      <Button variant="ghost" onClick={newRocket}>
        {t("results.newRocket")}
      </Button>
    </div>
  );
}
