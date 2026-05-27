import { PlasmaColor } from '../rendering/plasma_color.js';

/**
 * Diffuse corona glow distributed along the subject boundary.
 *
 * Physical model: corona discharge in air is sustained when the electric field
 * near a conductor surface exceeds the critical breakdown field (~30 kV/cm for
 * air at STP).  The glowing sheath is an ionised region whose luminosity is
 * proportional to E · exp(−r/λ), where λ is the ionisation length scale.
 *
 * On an AC source the corona pulses at 2× the supply frequency (full-wave
 * rectified appearance) because avalanches form on both half-cycles.
 *
 * Higher-curvature boundary regions (e.g. leaf tips, vein ends) have
 * geometrically enhanced E and therefore glow most intensely.
 */
export class Corona {
  /**
   * @param {{ x:number, y:number, fieldStrength:number }[]} subjectBoundary
   *   Array of boundary grid-cells with pre-computed initial field strength.
   * @param {import('../physics/field_solver.js').FieldSolver} fieldSolver
   * @param {import('../physics/humidity.js').HumidityModel}  humidity
   */
  constructor(subjectBoundary, fieldSolver, humidity) {
    this.subjectBoundary = subjectBoundary;
    this.fieldSolver     = fieldSolver;
    this.humidity        = humidity;

    // Normalisation: maximum field strength along the boundary
    this._maxField = subjectBoundary.reduce((m, p) => Math.max(m, p.fieldStrength), 1e-10);

    // Build glow-point array (one entry per boundary cell)
    this.glowPoints = subjectBoundary.map(p => ({
      x:             p.x,
      y:             p.y,
      intensity:     0,
      normalField:   p.fieldStrength / this._maxField, // 0–1, static
      color:         { r: 60, g: 0, b: 120, a: 0 }
    }));

    this._time = 0;
  }

  /**
   * Advance corona state for one timestep.
   * Intensity of each glow-point is driven by:
   *   I = normalField × (V/V_max) × |sin(ωt)| × humidityDiffuse
   * and smoothed with a first-order IIR.
   *
   * @param {number} voltage   - current effective voltage (normalised 0–100)
   * @param {number} frequency - AC frequency in kHz
   * @param {number} phase     - current AC phase in radians
   * @param {number} dt        - timestep in seconds
   */
  update(voltage, frequency, phase, dt) {
    this._time += dt;

    const vNorm       = voltage / 100;
    const pulseMag    = Math.abs(Math.sin(phase));
    const diffuse     = this.humidity.diffuseGlowFactor();
    const colorShift  = this.humidity.colorShift();

    // Spread factor: higher humidity → wider corona halo
    this.spreadRadius = 2 + diffuse * 8; // grid cells

    for (const gp of this.glowPoints) {
      // Target intensity: field × voltage × AC-pulse envelope
      const target = gp.normalField * vNorm * pulseMag * (0.6 + 0.4 * diffuse);

      // Smooth IIR approach to target (τ ≈ 30 ms)
      const tau = 0.03;
      const k   = 1 - Math.exp(-dt / tau);
      gp.intensity += (target - gp.intensity) * k;

      // Colour from plasma model + humidity shift
      const baseCol = PlasmaColor.coronaGlowColor(gp.intensity);
      gp.color = {
        r: Math.max(0, Math.min(255, baseCol.r + colorShift.r * gp.intensity)),
        g: Math.max(0, Math.min(255, baseCol.g + colorShift.g * gp.intensity)),
        b: Math.max(0, Math.min(255, baseCol.b + colorShift.b * gp.intensity)),
        a: baseCol.a
      };
    }
  }

  /** @returns {{ x,y,intensity,color,normalField }[]} */
  getGlowPoints() {
    return this.glowPoints;
  }

  /**
   * Interpolated glow intensity at an arbitrary grid position by summing
   * contributions from nearby boundary points with exponential decay.
   * @param {number} x
   * @param {number} y
   * @returns {number}
   */
  getGlowIntensity(x, y) {
    let total = 0;
    const lambda = 3.0; // decay length in grid cells
    for (const gp of this.glowPoints) {
      const d = Math.hypot(gp.x - x, gp.y - y);
      if (d > 20) continue; // skip distant points for performance
      total += gp.intensity * Math.exp(-d / lambda);
    }
    return Math.min(1, total);
  }

  /**
   * Plasma colour for a given local field strength and humidity.
   * @param {number} fieldStrength - normalised 0–1
   * @param {number} humidityRH    - 0–1
   * @returns {{ r,g,b,a }}
   */
  getColor(fieldStrength, humidityRH) {
    return PlasmaColor.coronaGlowColor(fieldStrength);
  }
}
