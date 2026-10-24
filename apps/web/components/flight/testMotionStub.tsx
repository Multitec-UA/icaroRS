/**
 * Test-only replacement for `motion/react` used by the flight component
 * tests. The global stub in vitest.setup.tsx is inert (its `animate` never
 * reports a value, so CountUp stays at 0 and `useReducedMotion` is pinned to
 * false). These components assert on the settled numbers and on the
 * reduced-motion start state, so their tests install this stub instead:
 * `animate` jumps straight to the target value and `useReducedMotion` reads
 * a hoisted flag the test can flip. The `motion.<tag>` proxy and `useInView`
 * mirror the global stub.
 *
 * Usage (inside a test file, with `motionState` from `vi.hoisted`):
 *   vi.mock("motion/react", async () =>
 *     (await import("./testMotionStub")).makeMotionStub(motionState));
 */

import type { ReactNode } from "react";

const MOTION_ONLY_PROPS = new Set([
  "initial",
  "animate",
  "exit",
  "whileInView",
  "whileHover",
  "whileTap",
  "viewport",
  "transition",
]);

function stripMotionProps(props: Record<string, unknown>) {
  const rest: Record<string, unknown> = {};
  for (const key of Object.keys(props)) {
    if (!MOTION_ONLY_PROPS.has(key)) rest[key] = props[key];
  }
  return rest;
}

export function makeMotionStub(state: { reduce: boolean }) {
  const motion = new Proxy(
    {},
    {
      get(_target, tag: string) {
        return function MotionStub({
          children,
          ...props
        }: { children?: ReactNode } & Record<string, unknown>) {
          const Tag = tag as unknown as "div";
          return <Tag {...stripMotionProps(props)}>{children}</Tag>;
        };
      },
    },
  );

  return {
    motion,
    useReducedMotion: () => state.reduce,
    useInView: () => true,
    animate: (
      _from: number,
      to: number,
      options?: { onUpdate?: (v: number) => void },
    ) => {
      options?.onUpdate?.(to);
      return { stop: () => {} };
    },
  };
}
