"use client";

/**
 * SitePicker — place-name search (OpenStreetMap Nominatim) + click-to-pick map.
 *
 * Controlled: the parent owns lat/lon and gets updates via onPick. The Leaflet
 * map is dynamically imported with ssr:false (Leaflet needs the browser).
 */

import dynamic from "next/dynamic";
import { useCallback, useRef, useState } from "react";
import { Spinner, TextInput } from "@/components/ui";

const MapInner = dynamic(() => import("./MapInner"), {
  ssr: false,
  loading: () => (
    <div className="flex h-80 w-full items-center justify-center rounded-2xl bg-white/[0.02] text-sm text-muted ring-1 ring-inset ring-white/10">
      Loading map…
    </div>
  ),
});

interface NominatimHit {
  lat: string;
  lon: string;
  display_name: string;
}

export function SitePicker({
  lat,
  lon,
  onPick,
}: {
  lat: number | null;
  lon: number | null;
  onPick: (lat: number, lon: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<NominatimHit[]>([]);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = useCallback(async (q: string) => {
    if (q.trim().length < 3) {
      setHits([]);
      return;
    }
    setSearching(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(q)}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      setHits(res.ok ? await res.json() : []);
    } catch {
      setHits([]);
    } finally {
      setSearching(false);
    }
  }, []);

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(value), 400);
  }

  function choose(hit: NominatimHit) {
    setQuery(hit.display_name);
    setHits([]);
    onPick(parseFloat(hit.lat), parseFloat(hit.lon));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <TextInput
          className="w-full"
          placeholder="Search a place (e.g. Alicante, Spain)…"
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
      <div className="overflow-hidden rounded-2xl ring-1 ring-inset ring-white/10">
        <MapInner lat={lat} lon={lon} onPick={onPick} />
      </div>
      <p className="text-xs text-muted">
        Click anywhere on the map to drop the launch point, or search for a place above.
      </p>
    </div>
  );
}
