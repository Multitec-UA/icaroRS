"use client";

/**
 * Root-level error boundary — the safety net for an uncaught throw anywhere
 * in the app's client tree, most notably the "must be used within
 * <Provider>" guards in WizardProvider, AuthGate, and LocaleProvider (see
 * their JSDoc — those guards are intentionally loud, to catch a real wiring
 * mistake during development). Without this file, such a throw produced a
 * blank page with no message and no recovery path.
 *
 * error.tsx is rendered *inside* app/layout.tsx's provider stack (Next
 * nests it between the layout and the page, see the Next.js error.js docs),
 * so LocaleProvider is always still mounted here even when the crash came
 * from deeper in the tree — useT() is safe to call.
 */

import { useEffect } from "react";
import { useT } from "@/components/i18n/LocaleProvider";
import { ErrorFallback } from "@/components/boundaries/ErrorFallback";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <ErrorFallback
      title={t("errors.boundaryTitle")}
      message={t("errors.boundaryMessage")}
      retry={{ label: t("errors.tryAgain"), onClick: reset }}
    />
  );
}
