/**
 * Townsend ionization physics for air at arbitrary pressure and temperature.
 *
 * Two key processes compete:
 *   α(E)  – Townsend first ionization coefficient (electron multiplication)
 *   η_a(E) – electron attachment coefficient (loss to O₂⁻ formation)
 *
 * Net ionization α − η_a > 0 is the condition for a self-sustaining avalanche.
 *
 * Townsend empirical coefficients for air (Raizer, "Gas Discharge Physics", 1991):
 *   α/p = A · exp(−B·p/E)   [cm⁻¹ torr⁻¹]
 *   A = 12 cm⁻¹ torr⁻¹
 *   B = 365 V cm⁻¹ torr⁻¹
 *
 * Meek's criterion for streamer formation: α·d > ln(10⁸) ≈ 18.4, often cited as ~20.
 */
export class IonizationModel {
  /**
   * @param {number} pressure    - ambient pressure in Pa (default: 101 325 Pa = 1 atm)
   * @param {number} temperature - ambient temperature in K (default: 293 K = 20 °C)
   */
  constructor(pressure = 101325, temperature = 293) {
    this.pressure    = pressure;
    this.temperature = temperature;
    // Convert to torr for Townsend coefficient formulae
    this.pressureTorr = pressure / 133.322;
  }

  /**
   * Townsend first ionization coefficient α(E) in m⁻¹.
   * Uses the standard empirical formula for dry air:
   *   α = A·p·exp(−B·p/E)
   * with E in V m⁻¹, p in torr.
   * Returns 0 for fields below 1 V/cm (numerical stability).
   *
   * @param {number} E - field magnitude in V/m
   * @returns {number} α in m⁻¹
   */
  firstTownsendCoefficient(E) {
    const p    = this.pressureTorr;
    const E_cm = E / 100; // V/m → V/cm
    if (E_cm < 1.0) return 0;

    const A        = 12;  // cm⁻¹ torr⁻¹
    const B        = 365; // V cm⁻¹ torr⁻¹
    const alpha_cm = A * p * Math.exp(-B * p / E_cm);
    return alpha_cm * 100; // cm⁻¹ → m⁻¹
  }

  /**
   * Electron attachment coefficient η_a(E) in m⁻¹.
   * Electron attachment to O₂ forms O₂⁻, removing free electrons.
   * Empirical form for air:
   *   η_a = C·p·exp(−D·(E/p − E₀/p)²)
   * where E₀ ≈ 25 kV/cm at STP is the attachment peak.
   *
   * @param {number} E - field magnitude in V/m
   * @returns {number} η_a in m⁻¹
   */
  attachmentCoefficient(E) {
    const p    = this.pressureTorr;
    const p0   = 760; // standard torr
    const E_cm = E / 100;

    const C          = 0.5;         // cm⁻¹ torr⁻¹
    const D          = 0.008;       // spread parameter
    const E0_per_p   = 2500 / p0;  // ≈ 3.29 V cm⁻¹ torr⁻¹ (≈ 25 kV/cm at STP)
    const E_per_p    = E_cm / p;
    const eta_cm     = C * p * Math.exp(-D * Math.pow(E_per_p - E0_per_p, 2));
    return eta_cm * 100; // cm⁻¹ → m⁻¹
  }

  /**
   * Net ionization coefficient (α − η_a) in m⁻¹.
   * Positive → net electron multiplication; negative → net loss.
   * @param {number} E - V/m
   * @returns {number}
   */
  netIonizationCoefficient(E) {
    return this.firstTownsendCoefficient(E) - this.attachmentCoefficient(E);
  }

  /**
   * Critical field strength E_crit at which α = η_a (onset of net ionization).
   * For dry air at STP this is ≈ 30 kV/cm = 3 × 10⁶ V/m.
   * Computed by binary search.
   * @returns {number} E_crit in V/m
   */
  criticalFieldStrength() {
    let lo = 1e4, hi = 2e7;
    for (let i = 0; i < 60; i++) {
      const mid = 0.5 * (lo + hi);
      if (this.netIonizationCoefficient(mid) < 0) lo = mid;
      else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /**
   * Exponential avalanche growth factor for uniform field over distance d.
   *   G = exp((α − η_a) · d)
   * @param {number} E        - V/m
   * @param {number} distance - m
   * @returns {number}
   */
  avalancheGrowthFactor(E, distance) {
    const net = this.netIonizationCoefficient(E);
    return Math.exp(net * distance);
  }

  /**
   * Meek's criterion for streamer formation: returns true if α·d > 20,
   * indicating ≥ 10⁸ electrons generated in the avalanche head.
   * @param {number} E         - field magnitude in V/m
   * @param {number} gapLength - gap length in m
   * @returns {boolean}
   */
  streamerCriterion(E, gapLength) {
    const alpha = this.firstTownsendCoefficient(E);
    return (alpha * gapLength) > 20;
  }
}
