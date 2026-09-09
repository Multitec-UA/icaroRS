import "@testing-library/jest-dom/vitest";

import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import type { ReactNode } from "react";

afterEach(() => {
  cleanup();
});

// ---------------------------------------------------------------------------
// next/navigation — App Router hooks have no meaning outside a real Next.js
// runtime. Every component test gets a stable no-op router; tests that care
// about a specific pathname or a `push` call override this per-test with
// `vi.mocked(useRouter)` / `vi.mocked(usePathname)`.
// ---------------------------------------------------------------------------
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  })),
  usePathname: vi.fn(() => "/"),
  useSearchParams: vi.fn(() => new URLSearchParams()),
}));

// ---------------------------------------------------------------------------
// motion/react — jsdom has no IntersectionObserver and no real viewport, so
// the actual library's `whileInView` / `useInView` never fire. Smoke tests
// only need to confirm the tree mounts without crashing, not that the
// animation library itself works, so every export is replaced with an inert
// equivalent (motion.div/span just render the plain tag; the hooks resolve
// to their "settled" state immediately).
// ---------------------------------------------------------------------------
vi.mock("motion/react", () => {
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
    useReducedMotion: () => false,
    useInView: () => true,
    animate: () => ({ stop: () => {} }),
  };
});
