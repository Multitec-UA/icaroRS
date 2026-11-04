import type { ReactNode } from "react";
import { cn } from "@/lib/styles";
import { cardClass } from "./classes";

/**
 * Card — the raised token surface. `innerClassName` is kept from the old
 * Double-Bezel API (it now styles the same single element) so existing
 * callers keep compiling.
 */
export function Card({
  children,
  className,
  innerClassName,
  as: Tag = "div",
}: {
  children: ReactNode;
  className?: string;
  innerClassName?: string;
  as?: "div" | "section" | "article" | "form";
}) {
  return <Tag className={cn(cardClass, "p-5", className, innerClassName)}>{children}</Tag>;
}
