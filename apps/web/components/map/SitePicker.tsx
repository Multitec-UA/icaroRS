"use client";

/**
 * SitePicker — place-name search (OpenStreetMap Nominatim, proxied through
 * our own `/api/geocode` route — see issue #55) + click-to-pick map.
 *
 * Controlled: the parent owns lat/lon and gets updates via onPick. The Leaflet
 * map is dynamically imported with ssr:false (Leaflet needs the browser).
 */

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { Callout, Spinner, TextInput } from "@/components/ui";
import { useT } from "@/components/i18n/LocaleProvider";
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
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GeocodeHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setHits([]);
      setSearchFailed(false);
      return;
    }
    setSearching(true);
    setSearchFailed(false);
    try {
      setHits(await geocodeSearch(q));
    } catch {
      // A failed lookup (network/upstream/throttle) is NOT the same as a
      // genuine zero-result search — surface it distinctly instead of
      // rendering an empty dropdown that looks identical to "no matches".
      setHits([]);
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

  function choose(hit: GeocodeHit) {
    setQuery(hit.display_name);
    setHits([]);
    onPick(parseFloat(hit.lat), parseFloat(hit.lon));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <TextInput
          className="w-full"
          placeholder={t("sitePicker.searchPlaceholder")}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted">
            <Spinner />
          </span>
        )}
        {hits.length > 0 && (
          <ul className="absolute z-[1000] mt-2 w-full overflow-hidden rounded-2xl bg-[#0b0b0e]/95 p-1.5 ring-1 ring-white/10 backdrop-blur-xl">
            {hits.map((hit, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => choose(hit)}
                  className="block w-full truncate rounded-xl px-3 py-2 text-left text-sm text-foreground/80 transition-colors hover:bg-white/[0.06] hover:text-foreground"
                >
                  {hit.display_name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {searchFailed && <Callout tone="error">{t("sitePicker.searchError")}</Callout>}
      <div className="overflow-hidden rounded-2xl ring-1 ring-inset ring-white/10">
        <MapInner lat={lat} lon={lon} onPick={onPick} />
      </div>
      <p className="text-xs text-muted">{t("sitePicker.helperText")}</p>
    </div>
  );
}
