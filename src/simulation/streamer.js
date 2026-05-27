import { DielectricBreakdownModel } from '../physics/dielectric_breakdown.js';

/**
 * Individual discharge streamer channel propagating through the electric field.
 *
 * Physical model:
 *  A streamer is a self-propagating ionised channel sustained by the photo-
 *  ionisation ahead of its tip.  The tip advances in the direction of the
 *  local electric field (positive streamers) or against it (negative), with
 *  the DBM determining stochastic branching.
 *
 *  In this implementation:
 *   - The tip advances one grid cell per call to step().
 *   - Candidate next-cells are the 8-connected neighbours of the current tip.
 *   - Each candidate receives a directional weight biasing growth *away* from
 *     the subject (outward discharge) – this replaces the dynamic field
 *     re-solve that a full streamer simulation would require.
 *   - The DBM then selects the next cell with probability ∝ |E|^η × dirWeight.
 *   - Channel intensity peaks at the tip (1.2×) and decays exponentially
 *     toward the origin; all points also decay slowly with age.
 *   - A streamer quenches when it exceeds its maximum length.
 */
export class Streamer {
  /**
   * @param {number} startX
   * @param {number} startY
   * @param {import('../physics/field_solver.js').FieldSolver}             fieldSolver
   * @param {import('../physics/dielectric_breakdown.js').DielectricBreakdownModel} dbm
   * @param {import('../physics/ionization.js').IonizationModel}           ionization
   * @param {import('../physics/humidity.js').HumidityModel}               humidity
   * @param {{ polarity?:string, voltage?:number, leafCenter?:{x,y} }}     options
   */
  constructor(startX, startY, fieldSolver, dbm, ionization, humidity, options = {}) {
    this.fieldSolver = fieldSolver;
    this.dbm         = dbm;
    this.ionization  = ionization;
    this.humidity    = humidity;

    this.polarity   = options.polarity   || 'positive';
    this.voltage    = options.voltage    || 50;
    this.leafCenter = options.leafCenter || {
      x: fieldSolver.width  / 2,
      y: fieldSolver.height / 2
    };

    // Channel: ordered list of points from root to tip
    this.channel = [{ x: startX, y: startY, intensity: 0.8, age: 0 }];

    // Set of visited cell keys ("x,y") for fast lookup
    this.visitedCells = new Set([`${startX},${startY}`]);

    this.age       = 0;
    this.alive     = true;
    this.quenched  = false;
    this.maxLength = 22 + Math.floor(Math.random() * 30); // 22–51 cells

    // Slight randomness in propagation speed to stagger channels visually
    this._growthDelay    = 0;
    this._growthInterval = 0.008 + Math.random() * 0.012; // seconds per cell

    this.branchPoints = [];

    this._gridW = fieldSolver.width;
    this._gridH = fieldSolver.height;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Advance the streamer by one timestep.
   * May grow by 0 or 1 cell depending on the internal growth-rate timer.
   * @param {number} dt - seconds
   */
  step(dt) {
    if (!this.alive) return;

    this.age           += dt;
    this._growthDelay  += dt;

    // Decay all existing channel point intensities
    for (let i = 0; i < this.channel.length; i++) {
      const pt      = this.channel[i];
      pt.age        += dt;
      const distTip  = (this.channel.length - 1) - i;
      // Tip stays bright; older/deeper cells fade with age and distance
      pt.intensity   = Math.exp(-distTip * 0.04) * Math.exp(-pt.age * 0.25);
    }

    // Grow by one cell once the timer fires
    if (this._growthDelay < this._growthInterval) return;
    this._growthDelay -= this._growthInterval;

    if (this.channel.length >= this.maxLength) {
      this.quench();
      return;
    }

    const tip = this.channel[this.channel.length - 1];
    const candidates = this._getCandidates(tip);

    if (candidates.length === 0) {
      this.quench();
      return;
    }

    const next = this.dbm.selectGrowthSite(candidates, this.fieldSolver);
    if (!next) {
      this.quench();
      return;
    }

    this.channel.push({ x: next.x, y: next.y, intensity: 1.2, age: 0 });
    this.visitedCells.add(`${next.x},${next.y}`);
  }

  /** @returns {boolean} */
  isAlive() { return this.alive; }

  /** @returns {boolean} */
  isDead() { return !this.alive; }

  /** @returns {{ x:number, y:number, intensity:number, age:number }[]} */
  getChannel() { return this.channel; }

  /** @returns {number} seconds since birth */
  getAge() { return this.age; }

  /** @returns {{ x:number, y:number, intensity:number, age:number }} */
  getTip() {
    return this.channel[this.channel.length - 1] || { x: 0, y: 0, intensity: 0, age: 0 };
  }

  /** @returns {{ x:number, y:number }[]} */
  getBranchPoints() { return this.branchPoints; }

  /**
   * Attempt to fork a secondary branch from near the current tip.
   * Only forks with 30% probability and only if the channel is long enough.
   * @returns {Streamer|null}
   */
  fork() {
    if (this.channel.length < 8) return null;
    if (Math.random() > 0.3)     return null;

    // Fork from 2–5 cells behind the current tip
    const offset    = 2 + Math.floor(Math.random() * 4);
    const forkIdx   = Math.max(0, this.channel.length - 1 - offset);
    const forkPoint = this.channel[forkIdx];

    const branch = new Streamer(
      forkPoint.x, forkPoint.y,
      this.fieldSolver, this.dbm, this.ionization, this.humidity,
      { polarity: this.polarity, voltage: this.voltage * 0.65, leafCenter: this.leafCenter }
    );

    // Shorter life for branches
    branch.maxLength = Math.max(8, Math.floor(this.maxLength * 0.55));

    // Prevent immediate overlap with parent
    for (const cell of this.visitedCells) {
      branch.visitedCells.add(cell);
    }

    this.branchPoints.push({ x: forkPoint.x, y: forkPoint.y });
    return branch;
  }

  /**
   * Mark this streamer as quenched (dead).
   * Sets a final flash of intensity at the tip so the endpoint lights up.
   */
  quench() {
    this.alive    = false;
    this.quenched = true;
    if (this.channel.length > 0) {
      this.channel[this.channel.length - 1].intensity = 1.8;
    }
  }

  // ── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Return the 8-connected neighbour cells of `tip` that are valid candidates
   * for the next growth step.  Each candidate carries a `dirWeight` in [0,1]
   * encoding how well the move aligns with the outward direction from the
   * leaf centre.
   *
   * For positive polarity, the field direction (E = −∇φ) already points
   * outward (from high-V leaf to low-V outer boundary), so we additionally
   * bias toward candidates that lie along E.
   */
  _getCandidates(tip) {
    const { x: tx, y: ty } = tip;

    // Outward unit vector from leaf centre to current tip
    const lcx = this.leafCenter.x, lcy = this.leafCenter.y;
    const odx  = tx - lcx, ody = ty - lcy;
    const omag = Math.sqrt(odx * odx + ody * ody) + 1e-10;
    const onx  = odx / omag, ony = ody / omag;

    // Field direction at tip (for positive streamers)
    const fieldAtTip = this.fieldSolver.getFieldVector(tx, ty);
    const fmag       = fieldAtTip.magnitude + 1e-10;
    const fnx        = fieldAtTip.Ex / fmag;
    const fny        = fieldAtTip.Ey / fmag;

    const candidates = [];

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;

        const nx = tx + dx, ny = ty + dy;

        // Grid bounds
        if (nx < 1 || nx >= this._gridW - 1 || ny < 1 || ny >= this._gridH - 1) continue;

        // Skip visited cells
        if (this.visitedCells.has(`${nx},${ny}`)) continue;

        // Skip electrode pixels that belong to the subject (mask=1 interior)
        const maskVal = this.fieldSolver.mask[ny * this._gridW + nx];
        if (maskVal === 1) continue; // do not re-enter the leaf

        // Directional weight: how much does this step align with outward direction?
        const dmag   = Math.sqrt(dx * dx + dy * dy);
        const sdx    = dx / dmag, sdy = dy / dmag;

        const outwardDot = sdx * onx + sdy * ony; // −1..1
        const fieldDot   = sdx * fnx + sdy * fny;  // −1..1

        // Combine: 60% outward-from-leaf, 40% along E-field direction
        const alignment = 0.6 * outwardDot + 0.4 * fieldDot;
        const dirWeight = Math.max(0.04, (alignment + 1) / 2); // map to (0..1)

        candidates.push({ x: nx, y: ny, dirWeight });
      }
    }

    return candidates;
  }
}
