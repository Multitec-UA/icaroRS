"use client";

/**
 * Formatting the runs board and the run report share: the created / launch
 * date-time in the app locale and a fixed UTC zone (hydration-safe, the
 * same string on server and client), and the catalog label of an
 * atmosphere model id (`models.*`), falling back to the id itself for a
 * model the catalog does not know.
 */

import { useMemo } from "react";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";

export function useRunFormatters() {
  const t = useT();
  const { locale } = useLocale();
  return useMemo(() => {
    const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
    const modelLabel = (model: string) => {
      const key = `models.${model}`;
      const label = t(key);
      return label === key ? model : label;
    };
    return { dateTime, modelLabel };
  }, [locale, t]);
}
