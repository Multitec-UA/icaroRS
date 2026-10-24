"use client";

/**
 * SitePicker — place-name search (OpenStreetMap Nominatim, proxied through
 * our own `/api/geocode` route — see issue #55) + click-to-pick map.
 *
 * Controlled: the parent owns lat/lon and gets updates via onPick. The Leaflet
 * map is dynamically imported with ssr:false (Leaflet needs the browser).
 */

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Callout, Spinner, TextInput } from "@/components/ui";
import { useLocale, useT } from "@/components/i18n/LocaleProvider";
import { cn, focusRing } from "@/lib/styles";
import { plural } from "@/lib/i18n";
import { geocodeSearch, type GeocodeHit } from "@/lib/geocode";

// A next/dynamic `loading:` callback renders wherever <MapInner> would in the
// JSX tree, so it's still a descendant of LocaleProvider (mounted at the root
// layout) — useT() works here exactly as it would in the component body.
function MapLoadingFallback() {
  const t = useT();
  return (
    <div className="flex h-80 w-full items-center justify-center rounded-2xl bg-white/[0.02] text-sm text-muted ring-1 ring-inset ring-white/10">
      {t("sitePicker.loadingMap")}
    </div>
  );
}

const MapInner = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: MapLoadingFallback,
});

export function SitePicker({
  lat,
  lon,
  onPick,
}: {
  lat: number | null;
  lon: number | null;
  onPick: (lat: number, lon: number) => void;
}) {
  const t = useT();
  const { locale } = useLocale();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  // The query whose completed search returned nothing — drives the empty
  // state, which is distinct from "not searched yet" and from a failure.
  const [emptyQuery, setEmptyQuery] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A search scheduled right before unmount must not fire into a dead tree.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setHits([]);
      setSearchFailed(false);
      setEmptyQuery(null);
      return;
    }
    setSearching(true);
    setSearchFailed(false);
    try {
      const results = await geocodeSearch(q);
      setHits(results);
      setEmptyQuery(results.length === 0 ? q : null);
    } catch {
      // A failed lookup (network/upstream/throttle) is NOT the same as a
      // genuine zero-result search — surface it distinctly instead of
      // rendering an empty dropdown that looks identical to "no matches".
      setHits([]);
      setEmptyQuery(null);
      setSearchFailed(true);
    } finally {
      setSearching(false);
    }
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 400);
  }

  function closeResults() {
    setHits([]);
    setEmptyQuery(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape" && (hits.length > 0 || emptyQuery !== null)) {
      e.preventDefault();
      closeResults();
    }
  }

  function choose(hit: GeocodeHit) {
    setQuery(hit.display_name);
    closeResults();
    onPick(parseFloat(hit.lat), parseFloat(hit.lon));
  }

  const showPanel = hits.length > 0 || emptyQuery !== null;

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <TextInput
          type="search"
          name="site-search"
          autoComplete="off"
          spellCheck={false}
          aria-label={t("sitePicker.searchLabel")}
          className="w-full"
          placeholder={t("sitePicker.searchPlaceholder")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
            <Spinner />
          </span>
        )}
        {/* Always mounted so the result count / empty state is announced
            when it changes, not only when the panel first appears. */}
        <div aria-live="polite" className="absolute z-[1000] mt-2 w-full">
          {showPanel && (
            <div className="overflow-hidden rounded-2xl bg-[#0b0b0e]/95 p-1.5 ring-1 ring-white/10 backdrop-blur-xl">
              {hits.length > 0 ? (
                <>
                  <p className="px-3 py-1 text-xs text-muted">
                    {plural(locale, hits.length, "sitePicker.resultsCount")}
                  </p>
                  <ul className="max-h-64 overflow-y-auto overscroll-contain">
                    {hits.map((hit) => (
                      <li key={`${hit.lat},${hit.lon}`}>
                        <button
                          type="button"
                          onClick={() => choose(hit)}
                          className={cn(
                            "block w-full truncate rounded-xl px-3 py-2 text-left text-sm text-foreground/80 transition-[background-color,color] hover:bg-white/[0.06] hover:text-foreground",
                            focusRing,
                          )}
                        >
                          {hit.display_name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="px-3 py-2 text-sm text-muted">
                  {t("sitePicker.noResults", { query: emptyQuery ?? "" })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {searchFailed && <Callout tone="error">{t("sitePicker.searchError")}</Callout>}
      <div className="overflow-hidden rounded-2xl ring-1 ring-inset ring-white/10">
        <MapInner lat={lat} lon={lon} onPick={onPick} />
      </div>
      <p className="text-xs text-muted">{t("sitePicker.helperText")}</p>
    </div>
  );
}
