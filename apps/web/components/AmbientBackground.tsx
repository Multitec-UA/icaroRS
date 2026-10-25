/**
 * AmbientBackground — fixed, pointer-events-none mesh of two slow-drifting
 * orbs over the page background. The drift is pure CSS (orb-a / orb-b
 * keyframes in globals.css) and the orb colours are theme tokens (`--orb-a`,
 * `--orb-b`), so the same component reads right in both the pastel light and
 * the soft dark theme with no client JS. Per the performance guardrails, blur
 * lives only on this fixed layer, never on scrolling content.
 */

export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="orb-a absolute -left-[15%] top-[-10%] h-[60vmax] w-[60vmax] rounded-full bg-[radial-gradient(circle,var(--orb-a),transparent_60%)] blur-3xl" />
      <div className="orb-b absolute -right-[15%] bottom-[-20%] h-[55vmax] w-[55vmax] rounded-full bg-[radial-gradient(circle,var(--orb-b),transparent_60%)] blur-3xl" />
    </div>
  );
}
