/**
 * AmbientBackground — fixed, pointer-events-none mesh of slow-drifting cyan/violet
 * orbs over the OLED canvas. The drift is pure CSS (orb-a / orb-b keyframes in
 * globals.css), so this stays a plain component with no client JS. Per the
 * performance guardrails, blur lives only on this fixed layer, never on
 * scrolling content.
 */

export function AmbientBackground() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="orb-a absolute -left-[15%] top-[-10%] h-[60vmax] w-[60vmax] rounded-full bg-[radial-gradient(circle,rgba(34,211,238,0.10),transparent_60%)] blur-3xl" />
      <div className="orb-b absolute -right-[15%] bottom-[-20%] h-[55vmax] w-[55vmax] rounded-full bg-[radial-gradient(circle,rgba(167,139,250,0.11),transparent_60%)] blur-3xl" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,rgba(255,255,255,0.04),transparent_55%)]" />
    </div>
  );
}
