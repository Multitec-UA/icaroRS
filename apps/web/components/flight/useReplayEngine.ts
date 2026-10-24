"use client";

/**
 * The replay model behind FlightReplay (S9). Simulated time is the canonical
 * state and lives in a ref: Trajectory3D's frame loop calls `advance` sixty
 * times a second and must never re-render the Canvas. The time is exposed as
 * a tiny external store (`subscribe` / `getTime`) so only the small HUD that
 * calls `useReplayTime` re-renders per frame. `playing` and `speed` are React
 * state because the controls render from them.
 *
 * 1× plays the flight in real time (one simulated second per wall second),
 * 4× four times faster. Reaching the end stops playback; Play from the end
 * restarts at the pad. Seeking (scrubber or timeline) pauses.
 */

import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type MutableRefObject,
} from "react";
import { timeToProgress } from "./flightMath";

export type ReplaySpeed = 1 | 4;

export interface ReplayState {
  time: number;
  playing: boolean;
  speed: ReplaySpeed;
}

export interface ReplayEngine {
  stateRef: MutableRefObject<ReplayState>;
  /** Last sample time, seconds (0 for an empty series). */
  duration: number;
  playing: boolean;
  speed: ReplaySpeed;
  /** External-store pair for `useReplayTime`: notified on every time change. */
  subscribe: (listener: () => void) => () => void;
  getTime: () => number;
  /** Per-frame callback for Trajectory3D: advances time, returns path progress ∈ [0,1]. */
  advance: (delta: number) => number;
  toggle: () => void;
  seek: (time: number) => void;
  setSpeed: (speed: ReplaySpeed) => void;
}

export function useReplayEngine(
  times: number[],
  { startAtEnd }: { startAtEnd: boolean },
): ReplayEngine {
  const duration = times.length > 0 ? times[times.length - 1] : 0;
  const stateRef = useRef<ReplayState>({
    time: startAtEnd ? duration : 0,
    playing: !startAtEnd,
    speed: 1,
  });
  const [playing, setPlaying] = useState(!startAtEnd);
  const [speed, setSpeedState] = useState<ReplaySpeed>(1);
  const listeners = useRef(new Set<() => void>());

  const notify = useCallback(() => {
    for (const listener of listeners.current) listener();
  }, []);
  const subscribe = useCallback((listener: () => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);
  const getTime = useCallback(() => stateRef.current.time, []);

  const advance = useCallback(
    (delta: number): number => {
      const s = stateRef.current;
      if (s.playing) {
        const before = s.time;
        s.time = Math.min(duration, s.time + delta * s.speed);
        if (before < duration && s.time >= duration) {
          s.playing = false;
          setPlaying(false);
        }
        if (s.time !== before) notify();
      }
      return timeToProgress(times, s.time);
    },
    [times, duration, notify],
  );

  const toggle = useCallback(() => {
    const s = stateRef.current;
    if (!s.playing && s.time >= duration) {
      s.time = 0;
      notify();
    }
    s.playing = !s.playing;
    setPlaying(s.playing);
  }, [duration, notify]);

  const seek = useCallback(
    (time: number) => {
      const s = stateRef.current;
      s.time = Math.min(duration, Math.max(0, time));
      s.playing = false;
      setPlaying(false);
      notify();
    },
    [duration, notify],
  );

  const setSpeed = useCallback((next: ReplaySpeed) => {
    stateRef.current.speed = next;
    setSpeedState(next);
  }, []);

  return useMemo(
    () => ({ stateRef, duration, playing, speed, subscribe, getTime, advance, toggle, seek, setSpeed }),
    [duration, playing, speed, subscribe, getTime, advance, toggle, seek, setSpeed],
  );
}

/** The replay's current time, re-rendering the caller on every change. */
export function useReplayTime(engine: ReplayEngine): number {
  return useSyncExternalStore(engine.subscribe, engine.getTime, engine.getTime);
}
