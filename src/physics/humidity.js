/**
 * Humidity effects on electrical breakdown voltage and discharge morphology.
 *
 * Physical background:
 *  - Water vapour (H₂O) has a lower first ionization potential than N₂/O₂,
 *    slightly reducing the breakdown voltage at high humidity.
 *  - H₂O is also electronegative, increasing electron attachment and thus
 *    producing more numerous, finer discharge filaments.
 *  - The hydroxyl radical OH* (formed in humid plasma) emits strongly at
 *    306 nm (UV/violet), shifting the plasma colour toward blue-white.
 *  - High humidity produces a more diffuse, glowing corona (reduced streamer
 *    sharpness) due to increased three-body attachment quenching.
 *
 * Reference: Peek, "Dielectric Phenomena in High Voltage Engineering" (1929);
 *            Kuffel & Zaengl, "High Voltage Engineering Fundamentals" (2000).
 */
export class HumidityModel {
  /**
   * @param {number} relativeHumidity - 0.0–1.0 (0 = dry, 1 = saturated)
   * @param {number} temperature      - ambient temperature in K
   */
  constructor(relativeHumidity = 0.5, temperature = 293) {
    this.rh          = Math.max(0, Math.min(1, relativeHumidity));
    this.temperature = temperature;
  }

  /** Update relative humidity (0–1). */
  setRelativeHumidity(rh) {
    this.rh = Math.max(0, Math.min(1, rh));
  }

  /**
   * Saturation vapour pressure of water [Pa] from the Magnus formula.
   *   p_sat = 610.78 × exp(17.27 × T_C / (T_C + 237.3))
   * @returns {number} Pa
   */
  _saturationPressure() {
    const Tc = this.temperature - 273.15; // K → °C
    return 610.78 * Math.exp(17.27 * Tc / (Tc + 237.3));
  }

  /**
   * Absolute humidity [g/m³] computed from RH and temperature.
   * Uses ideal-gas approximation:
   *   AH = 1000 × (M_w / R) × (RH × p_sat / T)
   * where M_w = 18.015 g/mol, R = 8.314 J/(mol·K).
   * @returns {number} g/m³
   */
  absoluteHumidity() {
    const p_sat = this._saturationPressure();
    const p_v   = this.rh * p_sat; // partial pressure of water vapour [Pa]
    // AH [kg/m³] = p_v × M_w / (R × T), then ×1000 for g/m³
    return (p_v * 18.015) / (8.314 * this.temperature) * 1000;
  }

  /**
   * Breakdown voltage correction factor (dimensionless, typically 0.88–1.05).
   * IEC/BS empirical formula:
   *   kv = 1 − 0.003 × (AH − 11)
   * clamped to [0.85, 1.10], where 11 g/m³ is the reference humidity at
   * which Peek's original data was gathered.
   * @returns {number}
   */
  breakdownVoltageCorrection() {
    const ah = this.absoluteHumidity();
    const kv = 1 - 0.003 * (ah - 11);
    return Math.max(0.85, Math.min(1.10, kv));
  }

  /**
   * Filament density multiplier.  Higher humidity produces more numerous,
   * finer streamers because electronegativity of H₂O increases the number
   * of separate avalanche channels.
   *   factor = 0.5 + 2.5 × RH²
   * Range: 0.5 (dry) → 3.0 (saturated).
   * @returns {number}
   */
  filamentDensityFactor() {
    return 0.5 + 2.5 * this.rh * this.rh;
  }

  /**
   * RGB colour delta due to OH* radical emission in humid plasma.
   * OH* emits at 306 nm (UV → perceived as blue-violet contribution).
   * Higher humidity shifts the channel colour toward blue-white.
   * @returns {{ r:number, g:number, b:number }}
   */
  colorShift() {
    const factor = this.rh;
    return {
      r: -factor * 35,  // reduce red component
      g:  factor * 20,  // slight green increase
      b:  factor * 60   // strong blue increase (OH* near-UV)
    };
  }

  /**
   * Diffuse glow factor.  High humidity → more diffuse corona, less sharp
   * filaments.  Returns a value in [0, 1] where 0 = sharp filaments,
   * 1 = fully diffuse glow.
   * @returns {number}
   */
  diffuseGlowFactor() {
    // Non-linear: effect is small at low RH, ramps up above 60%
    return Math.min(1, 0.3 + 0.7 * Math.pow(this.rh, 1.5));
  }
}
