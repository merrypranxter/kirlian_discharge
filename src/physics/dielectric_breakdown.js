/**
 * Dielectric Breakdown Model (DBM) for fractal discharge growth.
 *
 * Physical basis: In the DBM (Niemeyer, Pietronero & Wiesmann, 1984) the
 * probability that a candidate tip site grows is proportional to |E|^η where
 * E is the local electric-field magnitude.  η = 1 produces DLA-like diffuse
 * branching; η → ∞ approaches the deterministic shortest path (Lichtenberg
 * figure); η = 2–3 reproduces natural lightning and Kirlian streamer morphology.
 *
 * The theoretical fractal dimension for 2-D DBM is approximately
 *   D ≈ 2 − 1/(η + 1)
 * (Batrouni et al., 1996).
 */
export class DielectricBreakdownModel {
  /**
   * @param {number} eta - branching exponent (0.5–4.0 typical)
   */
  constructor(eta = 2.0) {
    this.eta = Math.max(0.1, eta);
  }

  /** Update the branching exponent at runtime. */
  setEta(eta) {
    this.eta = Math.max(0.1, Number(eta));
  }

  /**
   * For each candidate tip position, compute a normalised growth probability
   * proportional to (|E|^η) × dirWeight.  dirWeight (0–1) encodes a
   * directional bias supplied by the caller (e.g. alignment with outward
   * field direction) and is folded in multiplicatively so that the DBM
   * branching physics is preserved while unphysical backward growth is
   * suppressed.
   *
   * @param {{ x:number, y:number, dirWeight?:number }[]} candidates
   * @param {import('../physics/field_solver.js').FieldSolver} fieldSolver
   * @returns {number[]} normalised probability for each candidate
   */
  computeGrowthProbabilities(candidates, fieldSolver) {
    if (candidates.length === 0) return [];

    const rawProbs = candidates.map(({ x, y, dirWeight = 1.0 }) => {
      const { magnitude } = fieldSolver.getFieldVector(x, y);
      // Guard against zero field
      const score = Math.pow(magnitude + 1e-12, this.eta) * Math.max(0.02, dirWeight);
      return score;
    });

    const total = rawProbs.reduce((acc, v) => acc + v, 0);
    if (total < 1e-30) {
      // Uniform fallback to prevent zero-probability stall
      return rawProbs.map(() => 1 / candidates.length);
    }
    return rawProbs.map(p => p / total);
  }

  /**
   * Probabilistically select one candidate using DBM growth probabilities.
   * Implements standard roulette-wheel (fitness-proportional) selection.
   *
   * @param {{ x:number, y:number, dirWeight?:number }[]} candidates
   * @param {import('../physics/field_solver.js').FieldSolver} fieldSolver
   * @returns {{ x:number, y:number } | null}
   */
  selectGrowthSite(candidates, fieldSolver) {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const probs = this.computeGrowthProbabilities(candidates, fieldSolver);
    const r = Math.random();
    let cumulative = 0;

    for (let i = 0; i < probs.length; i++) {
      cumulative += probs[i];
      if (r <= cumulative) return candidates[i];
    }

    // Floating-point safety: return last candidate
    return candidates[candidates.length - 1];
  }

  /**
   * Theoretical fractal dimension estimate for 2-D DBM:
   *   D ≈ 2 − 1/(η + 1)
   * @returns {number}
   */
  getFractalDimension() {
    return 2 - 1 / (this.eta + 1);
  }
}
