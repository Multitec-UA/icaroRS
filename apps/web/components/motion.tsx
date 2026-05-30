"use client";

/**
 * Motion choreography helpers (issue #10), built on `motion` (ex–Framer Motion).
 * All curves are spring/soft cubic-beziers — never linear/ease-in-out — and all
 * animation rides transform/opacity/filter only (GPU-safe). Each helper honours
 * prefers-reduced-motion via the global media query and motion's own reducer.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import { animate, motion, useInView, useReducedMotion } from "motion/react";

const SOFT = [0.16, 1, 0.3, 1] as const;

/**
 * Reveal — gentle heavy fade-up + de-blur as the element enters the viewport.
 * Fires once. With reduced motion it renders statically (no initial offset).
 */
export function Reveal({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 24, filter: "blur(8px)" }}
      whileInView={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      viewport={{ once: true, margin: "-80px" }}
      transition={{ duration: 0.8, delay, ease: SOFT }}
    >
      {children}
    </motion.div>
  );
}

/**
 * FadeSwap — keyed enter/exit used for swapping wizard steps. The active step
 * slides up + fades in; mount it with a `key` that changes per step.
 */
export function FadeSwap({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12, filter: "blur(6px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.5, ease: SOFT }}
    >
      {children}
    </motion.div>
  );
}

/**
 * CountUp — animated count-up for a result scalar. Animates from 0 to `value`
 * the first time it scrolls into view; `format` controls the displayed string.
 */
export function CountUp({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [display, setDisplay] = useState(reduce ? value : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, value, {
      duration: 1.1,
      ease: SOFT,
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value, reduce]);

  return (
    <span ref={ref} className={className}>
      {format(display)}
    </span>
  );
}
