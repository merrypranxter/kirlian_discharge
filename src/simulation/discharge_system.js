import { FieldSolver }              from '../physics/field_solver.js';
import { DielectricBreakdownModel } from '../physics/dielectric_breakdown.js';
import { IonizationModel }          from '../physics/ionization.js';
import { HumidityModel }            from '../physics/humidity.js';
import { Streamer }                 from './streamer.js';
import { Corona }                   from './corona.js';

/**
 * Main orchestrator for the Kirlian discharge simulation.
 *
 * Geometry (grid coords):
 *  - Grid:    160 × 120 cells
 *  - Leaf:    centred at (80, 56), parametric shape rx≈24, ry≈36
 *    → tip at y≈9, base at y≈81, max-width ≈48 cells at y≈45
 *  - Outer ring: 2-cell border at V = 0 (ground)
 *  - Leaf interior + boundary: fixed electrode at V = 1 (HV)
 *
 * Each step():
 *  1. Advance AC phase  φ += 2π·f·dt
 *  2. Compute effective voltage  V_eff = V · |sin(φ)|
 *  3. Probabilistically spawn new streamers from high-field boundary points
 *  4. Step all active streamers; prune dead ones after their fade time
 *  5. Update corona glow
 */
export class DischargeSystem {
  /**
   * @param {{ width?:number, height?:number, voltage?:number,
   *            frequency?:number, eta?:number, humidity?:number,
   *            polarity?:string }} config
   */
  constructor(config = {}) {
    this.config = {
      width:     160,
      height:    120,
      voltage:   50,   // kV (normalised to 0–100 for display)
      frequency: 50,   // kHz
      eta:       2.0,  // DBM branching exponent
      humidity:  50,   // percent RH
      polarity:  'positive',
      ...config
    };

    this.fieldSolver    = null;
    this.dbm            = null;
    this.ionization     = null;
    this.humidityModel  = null;
    this.streamers      = [];
    this.corona         = null;
    this.subjectPoints  = [];   // outline (for rendering)
    this.subjectBoundary = [];  // boundary grid-cells (for streamer birth)

    this.time      = 0;
    this.phase     = 0;
    this.initialized = false;

    // Accumulated spawn credit for fractional spawn rates
    this._spawnAccum = 0;
  }

  // ── Public lifecycle ───────────────────────────────────────────────────────

  /**
   * Set up all physics objects, rasterise the leaf electrode, solve the
   * initial Laplace field.  Safe to call multiple times (re-initialises).
   */
  initialize() {
    const { width, height, eta, humidity, frequency } = this.config;

    this.fieldSolver   = new FieldSolver(width, height, 1.85);
    this.dbm           = new DielectricBreakdownModel(eta);
    this.ionization    = new IonizationModel();
    this.humidityModel = new HumidityModel(humidity / 100);
    this.streamers     = [];
    this._spawnAccum   = 0;

    this.fieldSolver.reset();

    // Outer boundary: two-cell ring at V = 0 (ground electrode)
    for (let x = 0; x < width; x++) {
      this.fieldSolver.setBoundaryCondition(x, 0,          0);
      this.fieldSolver.setBoundaryCondition(x, 1,          0);
      this.fieldSolver.setBoundaryCondition(x, height - 1, 0);
      this.fieldSolver.setBoundaryCondition(x, height - 2, 0);
    }
    for (let y = 0; y < height; y++) {
      this.fieldSolver.setBoundaryCondition(0,         y, 0);
      this.fieldSolver.setBoundaryCondition(1,         y, 0);
      this.fieldSolver.setBoundaryCondition(width - 1, y, 0);
      this.fieldSolver.setBoundaryCondition(width - 2, y, 0);
    }

    // Generate leaf outline and fill as conductor at V = 1
    const cx = width / 2, cy = Math.round(height * 0.47);
    const rx = Math.round(width * 0.15), ry = Math.round(height * 0.30);
    this.subjectPoints = this._generateLeafOutline(cx, cy, rx, ry, 360);
    this._rasteriseLeafElectrode(this.subjectPoints, width, height);

    // Solve Laplace field (~300 SOR iterations converges well for 160×120)
    this.fieldSolver.solve(350, 8e-6);

    // Find leaf surface cells (electrode adjacent to free space)
    this._findBoundaryPoints();

    // Corona glow object
    this.corona = new Corona(this.subjectBoundary, this.fieldSolver, this.humidityModel);

    this.time        = 0;
    this.phase       = 0;
    this.initialized = true;
  }

  /**
   * Advance simulation by dt seconds.
   * @param {number} dt
   */
  step(dt) {
    if (!this.initialized) return;

    const { voltage, frequency } = this.config;

    this.time  += dt;
    this.phase += 2 * Math.PI * frequency * 1000 * dt; // kHz → rad/s

    // Effective voltage (half-wave envelope, absolute value for AC)
    const vEff     = voltage * Math.abs(Math.sin(this.phase));
    const vNorm    = vEff / 100; // 0–1

    // Spawn rate: proportional to V², matches corona onset physics
    const filamentFactor = this.humidityModel.filamentDensityFactor();
    const spawnRate = vNorm * vNorm * 3.5 * filamentFactor; // streamers/s

    this._spawnAccum += spawnRate * dt;
    const maxStreamers = Math.round(20 + vNorm * 40 * filamentFactor);

    while (this._spawnAccum >= 1 && this.streamers.length < maxStreamers) {
      this._spawnAccum -= 1;
      this._spawnStreamer(vEff);
    }
    if (this._spawnAccum > 2) this._spawnAccum = 2; // cap accumulator

    // Step all streamers; probabilistically fork long ones
    const forkProb = 0.008 * vNorm;
    for (const s of this.streamers) {
      if (s.isAlive()) {
        s.step(dt);
        if (s.isAlive() && Math.random() < forkProb) {
          const branch = s.fork();
          if (branch && this.streamers.length < maxStreamers) {
            this.streamers.push(branch);
          }
        }
      }
    }

    // Retire streamers that have fully faded (age > 3 s after quench)
    this.streamers = this.streamers.filter(s => s.getAge() < 3.5);

    // Update corona
    this.corona.update(vEff, frequency, this.phase, dt);
  }

  /** Clear all streamers and reinitialise from scratch. */
  reset() {
    this.streamers   = [];
    this._spawnAccum = 0;
    this.time        = 0;
    this.phase       = 0;
    if (this.initialized) this.initialize();
  }

  /**
   * Replace the subject shape (points array) and re-initialise.
   * @param {{ x:number, y:number }[]} points
   */
  setSubjectShape(points) {
    this.subjectPoints = points;
    if (this.initialized) this.initialize();
  }

  // ── Getters ────────────────────────────────────────────────────────────────

  /** @returns {Streamer[]} */
  getStreamers()   { return this.streamers; }

  /** @returns {Corona} */
  getCorona()      { return this.corona; }

  /** @returns {FieldSolver} */
  getFieldSolver() { return this.fieldSolver; }

  /** @returns {{ x:number, y:number }[]} */
  getSubjectPoints() { return this.subjectPoints; }

  /**
   * Current snapshot of key physics quantities for the HUD overlay.
   * @returns {{ voltage:number, fieldStrength:number, ionizationRate:number,
   *             streamerCount:number, fractalDimension:number,
   *             phase:number, time:number }}
   */
  getPhysicsState() {
    const vEff = this.config.voltage * Math.abs(Math.sin(this.phase));

    // Scale normalised voltage to a representative physical E-field in V/m
    // (rough: 50 kV across a 5 mm gap ≈ 10 MV/m, scaled by vNorm)
    const E_phys = (vEff / 100) * 1e7;

    const ionRate = this.ionization
      ? Math.max(0, this.ionization.netIonizationCoefficient(E_phys))
      : 0;

    return {
      voltage:         vEff,
      fieldStrength:   E_phys,
      ionizationRate:  ionRate,
      streamerCount:   this.streamers.filter(s => s.isAlive()).length,
      fractalDimension: this.dbm ? this.dbm.getFractalDimension() : 1.5,
      phase:           this.phase,
      time:            this.time
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Parametric leaf outline.
   * x(t) = cx + rx · sin(t) · (1 − 0.22·cos(t)) · (1 + 0.055·sin(5t))
   * y(t) = cy − ry · (cos(t) + 0.30)
   *
   * Key geometry (cx=80, cy=56, rx=24, ry=36):
   *  tip  t=0  → (80, 9)
   *  base t=π  → (80, 81)
   *  max-width t=π/2 → x≈103, y≈45
   *
   * @param {number} cx, cy  centre
   * @param {number} rx, ry  half-extents
   * @param {number} n       number of sample points
   * @returns {{ x:number, y:number }[]}
   */
  _generateLeafOutline(cx, cy, rx, ry, n = 360) {
    const pts = [];
    for (let i = 0; i < n; i++) {
      const t    = (i / n) * 2 * Math.PI;
      const cosT = Math.cos(t), sinT = Math.sin(t);
      const lobe = 1 + 0.055 * Math.sin(5 * t); // subtle 2.5-per-side lobing
      const x    = cx + rx * sinT * (1 - 0.22 * cosT) * lobe;
      const y    = cy - ry * (cosT + 0.30);
      pts.push({ x, y });
    }
    return pts;
  }

  /**
   * Scanline-fill the leaf polygon and mark every interior and boundary
   * grid cell as a fixed-potential electrode at V = 1.
   */
  _rasteriseLeafElectrode(pts, width, height) {
    const N    = pts.length;
    let minY   = Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    const yLo = Math.max(2, Math.floor(minY));
    const yHi = Math.min(height - 3, Math.ceil(maxY));

    for (let y = yLo; y <= yHi; y++) {
      // Find all edge intersections at this scanline
      const xs = [];
      for (let i = 0; i < N; i++) {
        const p0 = pts[i], p1 = pts[(i + 1) % N];
        if ((p0.y <= y && p1.y > y) || (p1.y <= y && p0.y > y)) {
          const t = (y - p0.y) / (p1.y - p0.y);
          xs.push(p0.x + t * (p1.x - p0.x));
        }
      }
      xs.sort((a, b) => a - b);

      // Fill between pairs of intersections
      for (let i = 0; i < xs.length - 1; i += 2) {
        const xL = Math.max(2, Math.ceil(xs[i]));
        const xR = Math.min(width - 3, Math.floor(xs[i + 1]));
        for (let x = xL; x <= xR; x++) {
          this.fieldSolver.setBoundaryCondition(x, y, 1.0);
        }
      }
    }

    // Explicitly mark outline pixels (handles sub-pixel edges)
    for (const p of pts) {
      const x = Math.round(p.x), y = Math.round(p.y);
      if (x >= 2 && x < width - 2 && y >= 2 && y < height - 2) {
        this.fieldSolver.setBoundaryCondition(x, y, 1.0);
      }
    }
  }

  /**
   * Find all leaf-surface cells: electrode cells (mask=1 at V=1) that have
   * at least one free-space (mask=0) neighbour.  Sort descending by field
   * strength so the highest-field sites are first (streamer birth prefers them).
   */
  _findBoundaryPoints() {
    const { width, height } = this.config;
    const solver = this.fieldSolver;
    this.subjectBoundary = [];

    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const i = y * width + x;
        if (solver.mask[i] !== 1) continue;
        if (solver.phi[i] < 0.5) continue; // skip ground boundary cells

        const hasFreeNeighbour =
          solver.mask[(y - 1) * width + x] === 0 ||
          solver.mask[(y + 1) * width + x] === 0 ||
          solver.mask[y * width + (x - 1)] === 0 ||
          solver.mask[y * width + (x + 1)] === 0;

        if (hasFreeNeighbour) {
          const { magnitude } = solver.getFieldVector(x, y);
          this.subjectBoundary.push({ x, y, fieldStrength: magnitude });
        }
      }
    }

    this.subjectBoundary.sort((a, b) => b.fieldStrength - a.fieldStrength);
  }

  /**
   * Spawn one new streamer, choosing a birth site from the top-N high-field
   * boundary points using field-weighted roulette selection.
   * @param {number} vEff - current effective voltage (0–100)
   */
  _spawnStreamer(vEff) {
    if (this.subjectBoundary.length === 0) return;

    // Consider only the top 60 high-field boundary points
    const pool = this.subjectBoundary.slice(0, Math.min(60, this.subjectBoundary.length));

    // Roulette selection weighted by |E|^1.5
    const weights = pool.map(p => Math.pow(p.fieldStrength + 1e-10, 1.5));
    const total   = weights.reduce((a, b) => a + b, 0);
    let   r       = Math.random() * total;
    let   chosen  = pool[0];
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { chosen = pool[i]; break; }
    }

    const { width, height } = this.config;
    const streamer = new Streamer(
      chosen.x, chosen.y,
      this.fieldSolver, this.dbm, this.ionization, this.humidityModel,
      {
        polarity:   this.config.polarity,
        voltage:    vEff,
        leafCenter: { x: width / 2, y: Math.round(height * 0.47) }
      }
    );

    this.streamers.push(streamer);
  }
}
