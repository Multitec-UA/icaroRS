"use client";

/**
 * Tiny context linking the flight timeline to the replay (S9): FlightReplay
 * registers its `seek`, FlightTimeline calls it. Rows only become buttons
 * once a replay is registered, so a run without a 3D path (or one whose
 * series never arrived) shows a plain list instead of dead controls.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

type SeekFn = (time: number) => void;

interface ReplayContextValue {
  hasReplay: boolean;
  seek: SeekFn;
  register: (seek: SeekFn | null) => void;
}

const ReplayContext = createContext<ReplayContextValue | null>(null);

export function ReplayProvider({ children }: { children: ReactNode }) {
  const seekRef = useRef<SeekFn | null>(null);
  const [hasReplay, setHasReplay] = useState(false);

  const register = useCallback((seek: SeekFn | null) => {
    seekRef.current = seek;
    setHasReplay(seek !== null);
  }, []);
  const seek = useCallback<SeekFn>((time) => seekRef.current?.(time), []);

  const value = useMemo(() => ({ hasReplay, seek, register }), [hasReplay, seek, register]);
  return <ReplayContext.Provider value={value}>{children}</ReplayContext.Provider>;
}

/** Consumer side (the timeline). Outside a provider there is simply no replay to seek. */
export function useReplaySeek(): { hasReplay: boolean; seek: SeekFn } {
  const ctx = useContext(ReplayContext);
  return ctx ?? { hasReplay: false, seek: () => {} };
}

/** Producer side (the replay): registers `seek` for as long as the replay is mounted. */
export function useRegisterReplay(seek: SeekFn): void {
  const ctx = useContext(ReplayContext);
  const register = ctx?.register;
  useEffect(() => {
    if (!register) return;
    register(seek);
    return () => register(null);
  }, [register, seek]);
}
