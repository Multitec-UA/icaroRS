import type { ReactNode } from "react";
import { Reveal } from "@/components/motion";

/** One titled block of the inputs column, revealed with a small stagger. */
export function Section({
  title,
  action,
  index = 0,
  children,
}: {
  title: string;
  action?: ReactNode;
  index?: number;
  children: ReactNode;
}) {
  return (
    <Reveal delay={index * 0.06}>
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {action}
        </div>
        {children}
      </section>
    </Reveal>
  );
}
