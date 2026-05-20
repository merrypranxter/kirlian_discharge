import { PlasmaColor } from './plasma_color.js';

/**
 * Canvas 2D renderer for the Kirlian discharge simulation.
 *
 * Rendering pipeline (per frame):
 *  1. clear()            – near-black fill
 *  2. renderField()      – faint equipotential-line background texture
 *  3. renderSubject()    – leaf silhouette
 *  4. renderCorona()     – additive diffuse glow halo (lighter blending)
 *  5. renderStreamer()×N – additive plasma channel (lighter blending)
 *  6. applyBloom()       – Gaussian-blur copy composited additively
 *  7. renderPhysicsOverlay() – monospace HUD text
 */
export class CanvasRenderer {
  /**
   * @param {HTMLCanvasElement} canvas
   */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d', { alpha: false });

    // Off-screen canvas reused for bloom pass
    this._bloom       = document.createElement('canvas');
    this._bloom.width  = canvas.width;
    this._bloom.height = canvas.height;
    this._bloomCtx    = this._bloom.getContext('2d');

    // Pre-rendered field image (updated lazily when field changes)
    this._fieldImg    = null;
    this._fieldCanvas = document.createElement('canvas');
    this._fieldCtx    = this._fieldCanvas.getContext('2d');

    // Internal scale: grid → canvas pixels
    this.scaleX = 1;
    this.scaleY = 1;
  }

  /**
   * Update internal scale factors (call after canvas or grid size changes).
   * @param {number} sx - pixels per grid column
   * @param {number} sy - pixels per grid row
   */
  setScale(sx, sy) {
    this.scaleX = sx;
    this.scaleY = sy;
  }

  /**
   * Resize the off-screen bloom canvas to match the main canvas.
   * Call after any canvas resize event.
   */
  updateSize() {
    this._bloom.width  = this.canvas.width;
    this._bloom.height = this.canvas.height;
  }

  // ── Pass 1: background ─────────────────────────────────────────────────────

  /** Fill canvas with the deep-space background colour. */
  clear() {
    const { ctx, canvas } = this;
    ctx.fillStyle = '#050008';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // ── Pass 2: field equipotentials (optional guide lines) ───────────────────

  /**
   * Render a low-resolution field image (equipotential contours) as a very
   * faint background texture.  The field image is cached; it is only rebuilt
   * when FieldSolver marks it dirty.
   * @param {import('../physics/field_solver.js').FieldSolver} fieldSolver
   */
  renderField(fieldSolver) {
    if (!fieldSolver) return;

    // Lazily build field image at grid resolution
    const imgData = fieldSolver.buildFieldImage();
    if (imgData !== this._fieldImg) {
      this._fieldImg = imgData;
      this._fieldCanvas.width  = fieldSolver.width;
      this._fieldCanvas.height = fieldSolver.height;
      this._fieldCtx.putImageData(imgData, 0, 0);
    }

    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha            = 1;
    ctx.imageSmoothingEnabled  = true;
    ctx.imageSmoothingQuality  = 'medium';
    ctx.drawImage(
      this._fieldCanvas,
      0, 0, fieldSolver.width, fieldSolver.height,
      0, 0, this.canvas.width,  this.canvas.height
    );
    ctx.restore();
  }

  // ── Pass 3: subject silhouette ────────────────────────────────────────────

  /**
   * Draw the leaf (or other subject) as a filled dark silhouette with a
   * faint violet outline and central vein.
   * @param {{ x:number, y:number }[]} points - outline in grid coordinates
   */
  renderSubject(points) {
    if (!points || points.length < 3) return;
    const { ctx, scaleX, scaleY } = this;

    // Filled silhouette
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(points[0].x * scaleX, points[0].y * scaleY);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * scaleX, points[i].y * scaleY);
    }
    ctx.closePath();

    ctx.fillStyle   = '#08000f';
    ctx.fill();
    ctx.strokeStyle = 'rgba(90, 20, 140, 0.55)';
    ctx.lineWidth   = 0.8;
    ctx.stroke();

    // Central vein: find approximate tip and base of the leaf
    // (tip = minimum y point, base = maximum y point)
    let tipPt  = points[0], basePt = points[0];
    for (const p of points) {
      if (p.y < tipPt.y)  tipPt  = p;
      if (p.y > basePt.y) basePt = p;
    }
    const cx = (tipPt.x + basePt.x) / 2;

    ctx.beginPath();
    ctx.moveTo(tipPt.x  * scaleX, tipPt.y  * scaleY);
    ctx.bezierCurveTo(
      tipPt.x  * scaleX, (tipPt.y  + (basePt.y - tipPt.y) * 0.35) * scaleY,
      cx       * scaleX, (basePt.y - (basePt.y - tipPt.y) * 0.20) * scaleY,
      basePt.x * scaleX,  basePt.y * scaleY
    );
    ctx.strokeStyle = 'rgba(60, 10, 100, 0.40)';
    ctx.lineWidth   = 0.6;
    ctx.stroke();

    ctx.restore();
  }

  // ── Pass 4: corona glow ────────────────────────────────────────────────────

  /**
   * Render the diffuse corona halo around the subject boundary using additive
   * blending and radial gradients.
   * @param {import('../simulation/corona.js').Corona} corona
   */
  renderCorona(corona) {
    if (!corona) return;
    const { ctx, scaleX, scaleY } = this;
    const glowPts = corona.getGlowPoints();
    const spread  = (corona.spreadRadius || 5) * Math.max(scaleX, scaleY) * 0.5;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    for (const gp of glowPts) {
      if (gp.intensity < 0.005) continue;

      const cx  = gp.x * scaleX;
      const cy  = gp.y * scaleY;
      const r   = spread * (0.7 + gp.normalField * 1.8) * (0.5 + gp.intensity);
      const col = gp.color;
      const a   = Math.min(0.75, gp.intensity * 0.55);

      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      grad.addColorStop(0,   `rgba(${col.r},${col.g},${col.b},${a.toFixed(3)})`);
      grad.addColorStop(0.45,`rgba(${Math.round(col.r*0.6)},${Math.round(col.g*0.3)},${col.b},${(a*0.45).toFixed(3)})`);
      grad.addColorStop(1,   'rgba(0,0,0,0)');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  // ── Pass 5: streamer channels ─────────────────────────────────────────────

  /**
   * Render one streamer in two sub-passes:
   *  a) Wide soft glow halo (thick, semi-transparent)
   *  b) Bright narrow core channel
   * Both passes use additive blending for physically accurate over-exposure.
   * @param {import('../simulation/streamer.js').Streamer} streamer
   */
  renderStreamer(streamer) {
    const ch = streamer.getChannel();
    if (ch.length < 2) return;

    const { ctx, scaleX, scaleY } = this;
    const tip         = ch[ch.length - 1];
    const tipIntensity = Math.max(0, tip.intensity);

    if (tipIntensity < 0.003 && streamer.isDead()) return;

    // Humidity from the streamer's own model
    const humVal = streamer.humidity
      ? streamer.humidity.rh
      : 0.5;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap  = 'round';
    ctx.lineJoin = 'round';

    // Sub-pass A: glow halo (wide, soft purple)
    ctx.beginPath();
    ctx.moveTo(ch[0].x * scaleX, ch[0].y * scaleY);
    for (let i = 1; i < ch.length; i++) {
      ctx.lineTo(ch[i].x * scaleX, ch[i].y * scaleY);
    }
    const haloAlpha = Math.min(0.55, tipIntensity * 0.35);
    ctx.strokeStyle = `rgba(130,30,240,${haloAlpha.toFixed(3)})`;
    ctx.lineWidth   = Math.max(1.5, 5 * scaleX * tipIntensity);
    ctx.stroke();

    // Sub-pass B: bright plasma core (colour from physics model)
    ctx.beginPath();
    ctx.moveTo(ch[0].x * scaleX, ch[0].y * scaleY);
    for (let i = 1; i < ch.length; i++) {
      ctx.lineTo(ch[i].x * scaleX, ch[i].y * scaleY);
    }
    ctx.strokeStyle = PlasmaColor.airPlasmaColor(Math.min(1, tipIntensity * 0.85), humVal);
    ctx.lineWidth   = Math.max(0.8, 1.8 * scaleX);
    ctx.stroke();

    // Tip glow blob
    if (tipIntensity > 0.05) {
      this.renderGlow(
        tip.x * scaleX, tip.y * scaleY,
        Math.max(4, 10 * scaleX * tipIntensity),
        PlasmaColor.leaderChannelColor(tipIntensity),
        Math.min(1, tipIntensity * 0.9)
      );
    }

    ctx.restore();
  }

  /**
   * Draw a soft radial glow spot at canvas coordinates (x, y).
   * @param {number} x
   * @param {number} y
   * @param {number} radius
   * @param {{ r:number, g:number, b:number, a?:number }} color
   * @param {number} intensity - 0–1 scale factor for opacity
   */
  renderGlow(x, y, radius, color, intensity) {
    if (intensity < 0.01 || radius < 0.5) return;
    const ctx = this.ctx;

    const grad = ctx.createRadialGradient(x, y, 0, x, y, radius);
    const a    = Math.min(1, intensity * (color.a !== undefined ? color.a : 1));
    grad.addColorStop(0,   `rgba(${Math.round(color.r)},${Math.round(color.g)},${Math.round(color.b)},${a.toFixed(3)})`);
    grad.addColorStop(0.4, `rgba(${Math.round(color.r*0.6)},${Math.round(color.g*0.25)},${Math.round(color.b*0.8)},${(a*0.4).toFixed(3)})`);
    grad.addColorStop(1,   'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // ── Pass 6: bloom ─────────────────────────────────────────────────────────

  /**
   * Bloom / glow post-process:
   *  1. Copy the current canvas to the off-screen bloom canvas.
   *  2. Apply CSS blur filter to the bloom copy.
   *  3. Composite the blurred copy back onto the main canvas additively at
   *     low opacity.  This simulates camera lens bloom on bright plasma.
   */
  applyBloom() {
    const { ctx, canvas, _bloom, _bloomCtx } = this;

    _bloomCtx.clearRect(0, 0, _bloom.width, _bloom.height);
    _bloomCtx.drawImage(canvas, 0, 0);

    // Two-radius bloom: wide soft halo + tighter bright halo
    _bloomCtx.filter = `blur(${Math.max(2, Math.round(canvas.width / 220))}px)`;
    _bloomCtx.globalCompositeOperation = 'source-over';
    _bloomCtx.drawImage(_bloom, 0, 0);
    _bloomCtx.filter = 'none';

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.28;
    ctx.drawImage(_bloom, 0, 0);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  // ── Pass 7: HUD overlay ───────────────────────────────────────────────────

  /**
   * Render a monospace physics readout in the top-left corner.
   * @param {{ voltage:number, fieldStrength:number, ionizationRate:number,
   *           streamerCount:number, fractalDimension:number, time:number }} state
   */
  renderPhysicsOverlay(state) {
    if (!state) return;
    const { ctx } = this;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';

    // Semi-transparent panel
    ctx.fillStyle = 'rgba(0, 5, 18, 0.72)';
    ctx.fillRect(10, 10, 235, 130);
    ctx.strokeStyle = 'rgba(0, 200, 160, 0.25)';
    ctx.lineWidth   = 0.5;
    ctx.strokeRect(10, 10, 235, 130);

    ctx.fillStyle = '#00eebb';
    ctx.font      = '11px "Courier New", Courier, monospace';

    const rows = [
      `V_eff    : ${state.voltage.toFixed(1).padStart(6)} kV`,
      `E_field  : ${(state.fieldStrength / 1e6).toFixed(2).padStart(6)} MV/m`,
      `α-net    : ${state.ionizationRate.toExponential(2).padStart(9)} m⁻¹`,
      `Streamers: ${String(state.streamerCount).padStart(3)}`,
      `D_fractal: ${state.fractalDimension.toFixed(3)}`,
      `t        : ${state.time.toFixed(2).padStart(7)} s`
    ];

    rows.forEach((row, i) => {
      ctx.fillText(row, 20, 34 + i * 17);
    });

    ctx.restore();
  }
}
