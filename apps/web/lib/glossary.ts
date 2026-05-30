/**
 * Plain-language definitions for aerospace terms (RG-3.10 / AC-RG-3.10).
 * Shown as info tooltips so a non-expert is never blocked by jargon.
 */

export const GLOSSARY: Record<string, string> = {
  apogee:
    "The highest point the rocket reaches before it starts falling back down.",
  mach:
    "Speed compared to the speed of sound. Mach 1 means the rocket is moving as fast as sound (~343 m/s at sea level).",
  rail_departure:
    "The moment the rocket leaves the launch rail. A faster, more stable departure means a straighter, safer flight.",
  stability_margin:
    "How stable the rocket is, measured in calibers (body diameters). Roughly 1–2 cal is a healthy, controllable flight.",
  forecast:
    "Real weather forecast (GFS) for your launch date and place. Available for dates within about 16 days from now.",
  standard_atmosphere:
    "A textbook average atmosphere. Used when no real forecast is available — good for a quick, repeatable estimate.",
  uncertainty:
    "How much each input (mass, wind, thrust…) might vary in reality. It feeds the dispersion / landing-spread analysis.",
};
