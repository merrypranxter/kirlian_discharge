/**
 * Physics-based plasma emission colours derived from molecular emission spectra.
 *
 * Dominant emitters in air plasma:
 *  - N₂ Second Positive System (C³Π → B³Π): 315–380 nm, violet-purple.
 *    Strongest bands at 337.1 nm and 357.7 nm.
 *  - N₂⁺ First Negative System (B²Σ → X²Σ): 391.4 nm, violet-blue.
 *  - O atomic lines: 777.4 nm, 844.6 nm (near-IR, barely visible as red tinge).
 *  - OH* radical: 306–308 nm (UV → perceived blue-white in humid plasma).
 *
 * At low intensity the plasma appears deep violet (only the strongest N₂ bands).
 * At medium intensity: pink-purple (N₂ + broadening).
 * At high intensity: near-white with pink tinge (fully optically thick continuum).
 *
 * Reference: Pearse & Gaydon, "Identification of Molecular Spectra" (4th ed., 1976).
 */
export class PlasmaColor {
  /**
   * Linear interpolation between two colour objects {r,g,b,a}.
   * @param {{ r:number, g:number, b:number, a:number }} ca
   * @param {{ r:number, g:number, b:number, a:number }} cb
   * @param {number} t - 0 → ca, 1 → cb
   * @returns {{ r:number, g:number, b:number, a:number }}
   */
  static lerp(ca, cb, t) {
    t = Math.max(0, Math.min(1, t));
    const aA = ca.a !== undefined ? ca.a : 1;
    const aB = cb.a !== undefined ? cb.a : 1;
    return {
      r: ca.r + (cb.r - ca.r) * t,
      g: ca.g + (cb.g - ca.g) * t,
      b: ca.b + (cb.b - ca.b) * t,
      a: aA   + (aB   - aA)   * t
    };
  }

  /**
   * Convert a colour object to a CSS rgba() string.
   * @param {{ r:number, g:number, b:number, a?:number }} col
   * @returns {string}
   */
  static toRgba({ r, g, b, a = 1 }) {
    return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a.toFixed(3)})`;
  }

  /**
   * N₂ Second Positive System: violet-purple emission.
   * Intensity 0 → deep violet #1a0033; 0.5 → purple-pink #cc44ff; 1 → pink-white #ffaaff.
   * @param {number} intensity - 0–1
   * @returns {string} CSS rgba
   */
  static nitrogenEmission(intensity) {
    intensity = Math.max(0, Math.min(1, intensity));
    const stops = [
      { r:   0, g:  0, b:   0, a: 0.00 }, // 0.00 – transparent
      { r:  26, g:  0, b:  51, a: 0.25 }, // 0.25 – deep violet
      { r:  80, g:  0, b: 140, a: 0.60 }, // 0.50 – dark purple
      { r: 204, g: 44, b: 255, a: 0.88 }, // 0.75 – violet-pink
      { r: 255, g: 170, b: 255, a: 1.00 } // 1.00 – pink-white
    ];
    return PlasmaColor._multiLerp(stops, intensity);
  }

  /**
   * O₂⁺ First Negative System: blue-violet emission.
   * @param {number} intensity - 0–1
   * @returns {string} CSS rgba
   */
  static oxygenEmission(intensity) {
    intensity = Math.max(0, Math.min(1, intensity));
    const stops = [
      { r:   0, g:  0, b:   0, a: 0.00 },
      { r:   0, g: 15, b:  70, a: 0.25 },
      { r:  30, g: 80, b: 190, a: 0.65 },
      { r:  90, g: 160, b: 255, a: 0.88 },
      { r: 200, g: 225, b: 255, a: 1.00 } // blue-white
    ];
    return PlasmaColor._multiLerp(stops, intensity);
  }

  /**
   * Mixed N₂ + O₂ air plasma colour with humidity correction.
   * Main channel colour used for streamer cores.
   * Humidity shifts emission toward blue-white via OH* radical.
   * @param {number} intensity - 0–1
   * @param {number} humidity  - 0–1 (relative humidity fraction)
   * @returns {string} CSS rgba
   */
  static airPlasmaColor(intensity, humidity = 0.5) {
    intensity = Math.max(0, Math.min(1, intensity));
    const stops = [
      { r:   0, g:   0, b:   0, a: 0.00 },
      { r:  25, g:   0, b:  55, a: 0.35 },
      { r: 110, g:  15, b: 195, a: 0.75 },
      { r: 220, g:  75, b: 255, a: 0.92 },
      { r: 255, g: 195, b: 255, a: 1.00 }
    ];
    const col = PlasmaColor._lerpObj(stops, intensity);

    // Humidity-driven OH* shift (blue component increases, red decreases)
    const h = Math.max(0, Math.min(1, humidity)) * intensity;
    col.r = Math.max(0,   col.r - h * 40);
    col.g = Math.min(255, col.g + h * 25);
    col.b = Math.min(255, col.b + h * 55);

    return PlasmaColor.toRgba(col);
  }

  /**
   * Diffuse corona glow colour: softer, more transparent than channel core.
   * Returns a colour object (not a string) for use in gradient construction.
   * @param {number} intensity - 0–1
   * @returns {{ r:number, g:number, b:number, a:number }}
   */
  static coronaGlowColor(intensity) {
    intensity = Math.max(0, Math.min(1, intensity));
    const stops = [
      { r:   0, g:  0, b:   0, a: 0.00 },
      { r:  15, g:  0, b:  35, a: 0.15 },
      { r:  55, g:  0, b: 110, a: 0.38 },
      { r: 130, g: 50, b: 210, a: 0.58 },
      { r: 195, g: 130, b: 255, a: 0.75 } // lavender
    ];
    return PlasmaColor._lerpObj(stops, intensity);
  }

  /**
   * Hot leader channel core: white-hot centre with purple halo.
   * @param {number} intensity - 0–1
   * @returns {{ r:number, g:number, b:number, a:number }}
   */
  static leaderChannelColor(intensity) {
    intensity = Math.max(0, Math.min(1, intensity));
    const stops = [
      { r:   0, g:   0, b:   0, a: 0.00 },
      { r:  50, g:   0, b: 110, a: 0.45 },
      { r: 175, g:  65, b: 255, a: 0.80 },
      { r: 255, g: 175, b: 255, a: 0.95 },
      { r: 255, g: 255, b: 255, a: 1.00 } // white-hot
    ];
    return PlasmaColor._lerpObj(stops, intensity);
  }

  // ── Internal helpers ────────────────────────────────────────────────────────

  /** Multi-stop lerp → CSS rgba string. */
  static _multiLerp(stops, t) {
    return PlasmaColor.toRgba(PlasmaColor._lerpObj(stops, t));
  }

  /** Multi-stop lerp → colour object. */
  static _lerpObj(stops, t) {
    const idx  = t * (stops.length - 1);
    const lo   = Math.floor(idx);
    const hi   = Math.min(stops.length - 1, lo + 1);
    const frac = idx - lo;
    return PlasmaColor.lerp(stops[lo], stops[hi], frac);
  }
}
