"use client";

/**
 * Trajectory3D — animated 3D flight path (issue #11).
 *
 * Renders the (East, North, Up) trajectory as a glowing line over a ground
 * grid, with a rocket marker that travels the path on a play/scrub timeline.
 * Orbit to rotate, wheel to zoom. react-three-fiber + drei.
 *
 * Performance: playback is driven through a ref in useFrame (no per-frame React
 * state), so the Canvas never re-renders during animation — only the small
 * timeline component ticks its own slider. Client-only; dynamically imported
 * (ssr:false) so three never runs during SSR and stays code-split.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Grid, Line, OrbitControls } from "@react-three/drei";
import * as THREE from "three";
import { Button } from "@/components/ui";

const SCENE_SIZE = 6; // half-extent the trajectory is scaled to fit
const PLAY_SECONDS = 9; // wall-clock duration of one full play-through

/** Map (East, North, Up) metres → a uniformly-scaled three.js point (Y up). */
function toScenePoints(path: [number, number, number][]): {
  points: THREE.Vector3[];
  scale: number;
} {
  let maxExtent = 1e-6;
  for (const [e, n, u] of path) {
    maxExtent = Math.max(maxExtent, Math.abs(e), Math.abs(n), Math.abs(u));
  }
  const scale = SCENE_SIZE / maxExtent;
  const points = path.map(
    ([e, n, u]) => new THREE.Vector3(e * scale, u * scale, n * scale),
  );
  return { points, scale };
}

/** Position along the polyline at progress p ∈ [0,1] (linear between samples). */
function sampleAt(points: THREE.Vector3[], p: number, out: THREE.Vector3): void {
  if (points.length === 0) return;
  const clamped = Math.min(1, Math.max(0, p));
  const f = clamped * (points.length - 1);
  const i = Math.floor(f);
  if (i >= points.length - 1) {
    out.copy(points[points.length - 1]);
    return;
  }
  out.copy(points[i]).lerp(points[i + 1], f - i);
}

interface PlayState {
  progress: number;
  playing: boolean;
}

function RocketMarker({
  points,
  advance,
}: {
  points: THREE.Vector3[];
  /** Advance playback by `delta` seconds and return the new progress ∈ [0,1]. */
  advance: (delta: number) => number;
}) {
  const group = useRef<THREE.Group>(null);
  const pos = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, delta) => {
    const p = advance(delta);
    sampleAt(points, p, pos);
    group.current?.position.copy(pos);
  });

  return (
    <group ref={group}>
      <mesh>
        <sphereGeometry args={[0.12, 24, 24]} />
        <meshStandardMaterial
          color="#22d3ee"
          emissive="#22d3ee"
          emissiveIntensity={1.6}
          toneMapped={false}
        />
      </mesh>
      <pointLight color="#22d3ee" intensity={6} distance={4} />
    </group>
  );
}

function Scene({
  points,
  advance,
}: {
  points: THREE.Vector3[];
  advance: (delta: number) => number;
}) {
  const apogee = points[points.length - 1];
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[6, 12, 8]} intensity={1.1} />

      <Grid
        args={[SCENE_SIZE * 4, SCENE_SIZE * 4]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#1b1b22"
        sectionSize={2.5}
        sectionThickness={1}
        sectionColor="#2a2a35"
        fadeDistance={SCENE_SIZE * 6}
        fadeStrength={1.5}
        infiniteGrid
      />

      {/* Full trajectory + a faint vertical drop line to the landing point. */}
      <Line points={points} color="#a78bfa" lineWidth={2} transparent opacity={0.85} />
      {apogee && (
        <Line
          points={[apogee, new THREE.Vector3(apogee.x, 0, apogee.z)]}
          color="#a78bfa"
          lineWidth={1}
          dashed
          dashSize={0.18}
          gapSize={0.12}
          transparent
          opacity={0.35}
        />
      )}

      <RocketMarker points={points} advance={advance} />

      <OrbitControls
        enablePan={false}
        minDistance={SCENE_SIZE * 0.6}
        maxDistance={SCENE_SIZE * 4}
        autoRotate
        autoRotateSpeed={0.4}
        target={[0, SCENE_SIZE * 0.35, 0]}
      />
    </>
  );
}

function Timeline({
  state,
  playing,
  onToggle,
  onSeek,
}: {
  state: MutableRefObject<PlayState>;
  playing: boolean;
  onToggle: () => void;
  onSeek: (v: number) => void;
}) {
  const [val, setVal] = useState(0);

  // Mirror the ref-driven progress into the slider without touching the Canvas.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      setVal(state.current.progress);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [state]);

  return (
    <div className="flex items-center gap-4">
      <Button variant="ghost" onClick={onToggle} className="h-10 shrink-0 px-5">
        {playing ? "Pause" : "Play"}
      </Button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.001}
        value={val}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        aria-label="Scrub flight timeline"
        className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-white/10 accent-cyan-400"
      />
      <span className="tabular-readout w-12 shrink-0 text-right text-sm text-muted">
        {Math.round(val * 100)}%
      </span>
    </div>
  );
}

export function Trajectory3D({ path }: { path: [number, number, number][] }) {
  const { points } = useMemo(() => toScenePoints(path), [path]);
  const state = useRef<PlayState>({ progress: 0, playing: true });
  const [playing, setPlaying] = useState(true);

  // Playback mutation lives here, in the component that OWNS the ref — children
  // only call these callbacks (they never mutate the shared state directly).
  const advance = useCallback((delta: number): number => {
    const s = state.current;
    if (s.playing) {
      const before = s.progress;
      s.progress = Math.min(1, s.progress + delta / PLAY_SECONDS);
      if (before < 1 && s.progress >= 1) {
        s.playing = false;
        setPlaying(false);
      }
    }
    return s.progress;
  }, []);

  const toggle = useCallback(() => {
    const s = state.current;
    // Pressing play at the end restarts from the launch pad.
    if (!s.playing && s.progress >= 1) s.progress = 0;
    s.playing = !s.playing;
    setPlaying(s.playing);
  }, []);

  const seek = useCallback((v: number) => {
    state.current.progress = v;
    state.current.playing = false;
    setPlaying(false);
  }, []);

  if (points.length < 2) return null;

  return (
    <div className="flex flex-col gap-4">
      <div className="h-[440px] w-full overflow-hidden rounded-[calc(2rem-0.375rem)]">
        <Canvas
          dpr={[1, 2]}
          camera={{ position: [SCENE_SIZE * 1.4, SCENE_SIZE * 1.1, SCENE_SIZE * 1.4], fov: 50 }}
        >
          <color attach="background" args={["#070709"]} />
          <fog attach="fog" args={["#070709", SCENE_SIZE * 3, SCENE_SIZE * 7]} />
          <Scene points={points} advance={advance} />
        </Canvas>
      </div>
      <Timeline state={state} playing={playing} onToggle={toggle} onSeek={seek} />
    </div>
  );
}
