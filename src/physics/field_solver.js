/**
 * Solves the 2D Laplace equation ∇²φ = 0 on a rectangular grid using
 * Successive Over-Relaxation (SOR).  The potential φ ranges from 0 (ground)
 * to 1 (high-voltage electrode).  Electric field is derived as E = −∇φ via
 * central finite differences.
 */
export class FieldSolver {
  /**
   * @param {number} width  - grid columns
   * @param {number} height - grid rows
   * @param {number} omega  - SOR relaxation factor (1 < ω < 2); near-optimal
   *                          ω ≈ 2/(1 + sin(π/max(W,H))) ≈ 1.85 for 160×120
   */
  constructor(width, height, omega = 1.85) {
    this.width  = width;
    this.height = height;
    this.omega  = omega;

    // φ: electrostatic potential at each grid cell
    this.phi = new Float32Array(width * height);

    // mask: 0 = free space, 1 = fixed-potential electrode, 2 = dielectric subject
    this.mask = new Uint8Array(width * height);

    // Relative permittivity for dielectric cells (default: 1 = air)
    this.permittivity = new Float32Array(width * height).fill(1.0);

    // Stored fixed-potential values for electrode cells
    this.boundaryValues = new Float32Array(width * height);

    // Cached field visualisation ImageData (populated on demand, null until first use)
    this._fieldImageCache = null;
    this._fieldImageDirty = true;
  }

  /** Wipe all arrays back to zero / air. */
  reset() {
    this.phi.fill(0);
    this.mask.fill(0);
    this.permittivity.fill(1.0);
    this.boundaryValues.fill(0);
    this._fieldImageDirty = true;
  }

  /** @private Linear index from grid coordinates. */
  _idx(x, y) {
    return y * this.width + x;
  }

  /**
   * Fix a single grid cell to a constant potential (Dirichlet BC).
   * @param {number} x
   * @param {number} y
   * @param {number} value - normalised potential, e.g. 0 = ground, 1 = HV
   */
  setBoundaryCondition(x, y, value) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = this._idx(x, y);
    this.mask[i]           = 1;
    this.phi[i]            = value;
    this.boundaryValues[i] = value;
    this._fieldImageDirty  = true;
  }

  /**
   * Mark an array of grid points as a fixed-potential electrode.
   * @param {{x:number, y:number}[]} points
   * @param {number} voltage - normalised potential
   */
  setElectrode(points, voltage) {
    for (const p of points) {
      this.setBoundaryCondition(Math.round(p.x), Math.round(p.y), voltage);
    }
  }

  /**
   * Mark an array of grid points as a dielectric subject with given
   * relative permittivity.  Cells already marked as electrode are left alone.
   * @param {{x:number, y:number}[]} points
   * @param {number} permittivity - ε_r (e.g. 40 for biological tissue)
   */
  setSubject(points, permittivity = 4.0) {
    for (const p of points) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (x < 0 || x >= this.width || y < 0 || y >= this.height) continue;
      const i = this._idx(x, y);
      if (this.mask[i] !== 1) {
        this.mask[i]           = 2;
        this.permittivity[i]   = permittivity;
        this._fieldImageDirty  = true;
      }
    }
  }

  /**
   * Run Successive Over-Relaxation until convergence or iteration limit.
   * Free cells (mask=0) obey the discrete Laplace stencil; dielectric cells
   * (mask=2) use a permittivity-weighted average of their neighbours.
   * Electrode cells (mask=1) are held at their fixed boundary value.
   *
   * @param {number} maxIterations
   * @param {number} tolerance  - stop when max |Δφ| per sweep < tolerance
   * @returns {number} - actual number of iterations performed
   */
  solve(maxIterations = 300, tolerance = 1e-5) {
    const { width, height, phi, mask, omega, boundaryValues, permittivity } = this;
    let iter = 0;

    for (iter = 0; iter < maxIterations; iter++) {
      let maxDelta = 0;

      for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
          const i = y * width + x;

          if (mask[i] === 1) {
            // Electrode: enforce Dirichlet condition
            phi[i] = boundaryValues[i];
            continue;
          }

          let phiNew;
          if (mask[i] === 2) {
            // Dielectric: permittivity-weighted average of 4 face-neighbours.
            // Derived from ∇·(ε∇φ)=0 with piecewise-constant ε.
            const eps = permittivity[i];
            const epsL = permittivity[i - 1];
            const epsR = permittivity[i + 1];
            const epsU = permittivity[i - width];
            const epsD = permittivity[i + width];

            const wL = 2 * epsL * eps / (epsL + eps);
            const wR = 2 * epsR * eps / (epsR + eps);
            const wU = 2 * epsU * eps / (epsU + eps);
            const wD = 2 * epsD * eps / (epsD + eps);
            const wSum = wL + wR + wU + wD;

            phiNew = (wL * phi[i - 1] + wR * phi[i + 1] +
                      wU * phi[i - width] + wD * phi[i + width]) / wSum;
          } else {
            // Free space: standard 5-point Laplacian average
            phiNew = 0.25 * (phi[i - 1] + phi[i + 1] +
                             phi[i - width] + phi[i + width]);
          }

          const delta = omega * (phiNew - phi[i]);
          phi[i] += delta;
          const absDelta = delta < 0 ? -delta : delta;
          if (absDelta > maxDelta) maxDelta = absDelta;
        }
      }

      if (maxDelta < tolerance) break;
    }

    this._fieldImageDirty = true;
    return iter;
  }

  /**
   * Bilinear-interpolated potential at arbitrary (possibly fractional) grid
   * coordinate.  Clamps to the grid boundary.
   * @param {number} x
   * @param {number} y
   * @returns {number} φ in [0,1]
   */
  getPotential(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    const x1 = x0 + 1,        y1 = y0 + 1;

    if (x0 < 0 || x1 >= this.width || y0 < 0 || y1 >= this.height) {
      const xi = Math.max(0, Math.min(this.width  - 1, Math.round(x)));
      const yi = Math.max(0, Math.min(this.height - 1, Math.round(y)));
      return this.phi[this._idx(xi, yi)];
    }

    const fx = x - x0, fy = y - y0;
    const base = y0 * this.width + x0;
    return (this.phi[base]             * (1 - fx) * (1 - fy) +
            this.phi[base + 1]         * fx        * (1 - fy) +
            this.phi[base + this.width]    * (1 - fx) * fy        +
            this.phi[base + this.width + 1] * fx        * fy);
  }

  /**
   * Electric field vector E = −∇φ at grid point (x,y) via central finite
   * differences.
   * @param {number} x
   * @param {number} y
   * @returns {{ Ex:number, Ey:number, magnitude:number }}
   */
  getFieldVector(x, y) {
    const h  = 0.5;
    const Ex = -(this.getPotential(x + h, y) - this.getPotential(x - h, y)) / (2 * h);
    const Ey = -(this.getPotential(x, y + h) - this.getPotential(x, y - h)) / (2 * h);
    const magnitude = Math.sqrt(Ex * Ex + Ey * Ey);
    return { Ex, Ey, magnitude };
  }

  /** Alias for getFieldVector. */
  getGradient(x, y) {
    return this.getFieldVector(x, y);
  }

  /**
   * Scan the entire free-space domain and return the maximum |E| found.
   * Used for normalisation in renderers.
   * @returns {number}
   */
  getMaxFieldStrength() {
    let maxE = 0;
    for (let y = 1; y < this.height - 1; y++) {
      for (let x = 1; x < this.width - 1; x++) {
        if (this.mask[y * this.width + x] !== 0) continue;
        const { magnitude } = this.getFieldVector(x, y);
        if (magnitude > maxE) maxE = magnitude;
      }
    }
    return maxE;
  }

  /**
   * Build a low-resolution RGBA ImageData representing the potential field
   * and equipotential contours.  Result is cached until the next solve().
   * @returns {ImageData}
   */
  buildFieldImage() {
    if (!this._fieldImageDirty && this._fieldImageCache) return this._fieldImageCache;

    const W = this.width, H = this.height;
    const imgData = new ImageData(W, H);
    const data    = imgData.data;
    const levels  = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
    const thresh  = 0.018;

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i  = y * W + x;
        const pi = i * 4;
        const p  = this.phi[i];
        let onContour = false;
        for (const lv of levels) {
          if (Math.abs(p - lv) < thresh) { onContour = true; break; }
        }
        if (onContour && this.mask[i] === 0) {
          data[pi]     = 30;
          data[pi + 1] = 0;
          data[pi + 2] = 70;
          data[pi + 3] = 55;
        }
      }
    }

    this._fieldImageCache = imgData;
    this._fieldImageDirty = false;
    return imgData;
  }
}
