/**
 * Compatibility entry: `@/components/ui` resolves to this file before the
 * `components/ui/` directory, so it re-exports the control kit (S2) and every
 * existing import keeps working. Add primitives in `components/ui/`, not here.
 */

export * from "./ui/index";
