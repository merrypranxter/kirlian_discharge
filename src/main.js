/**
 * Kirlian Discharge Simulator – main entry point.
 *
 * Wires together the physics engine, simulation system, and renderer.
 * Attaches UI control events and runs the requestAnimationFrame loop.
 *
 * Exported `system` and `renderer` objects are available on the browser
 * console for live parameter tweaking:
 *   system.config.voltage = 80;
 *   system.config.eta     = 3.5;
 */

import { DischargeSystem }  from './simulation/discharge_system.js';
import { CanvasRenderer }   from './rendering/canvas_renderer.js';

// ── Canvas setup ────────────────────────────────────────────────────────────

const canvas   = document.getElementById('discharge-canvas');
const panelEl  = document.getElementById('controls-panel');

function getCanvasSize() {
  const panelW = panelEl ? panelEl.offsetWidth : 280;
  return {
    w: window.innerWidth  - panelW,
    h: window.innerHeight
  };
}

function resizeCanvas() {
  const { w, h } = getCanvasSize();
  canvas.width   = Math.max(400, w);
  canvas.height  = Math.max(300, h);
  renderer.updateSize();
  renderer.setScale(canvas.width / GRID_W, canvas.height / GRID_H);
}

// ── Simulation constants ────────────────────────────────────────────────────

const GRID_W = 160;
const GRID_H = 120;

// ── Initial config ──────────────────────────────────────────────────────────

const config = {
  width:     GRID_W,
  height:    GRID_H,
  voltage:   50,
  frequency: 50,
  eta:       2.0,
  humidity:  50,
  polarity:  'positive'
};

// ── Instantiate objects ─────────────────────────────────────────────────────

const system   = new DischargeSystem(config);
const renderer = new CanvasRenderer(canvas);

// ── Boot sequence ───────────────────────────────────────────────────────────

// Show loading message while solver runs
function showLoading(show) {
  const el = document.getElementById('loading-msg');
  if (el) el.style.display = show ? 'block' : 'none';
}

showLoading(true);

// Defer solver to next tick so the browser can paint the loading state first
setTimeout(() => {
  system.initialize();
  resizeCanvas();
  showLoading(false);
  requestAnimationFrame(loop);
}, 30);

window.addEventListener('resize', () => {
  resizeCanvas();
});

// ── Animation loop ──────────────────────────────────────────────────────────

let lastTime = 0;

function loop(ts) {
  const dt = Math.min((ts - lastTime) / 1000, 0.05); // cap at 50 ms
  lastTime = ts;

  system.step(dt);

  renderer.clear();
  renderer.renderField(system.getFieldSolver());
  renderer.renderSubject(system.getSubjectPoints());
  renderer.renderCorona(system.getCorona());

  for (const s of system.getStreamers()) {
    renderer.renderStreamer(s);
  }

  renderer.applyBloom();
  renderer.renderPhysicsOverlay(system.getPhysicsState());

  requestAnimationFrame(loop);
}

// ── UI controls ─────────────────────────────────────────────────────────────

function bindSlider(id, valueId, unit, min, max, decimals, setter) {
  const slider = document.getElementById(id);
  const label  = document.getElementById(valueId);
  if (!slider) return;

  slider.addEventListener('input', () => {
    const v = parseFloat(slider.value);
    if (label) label.textContent = v.toFixed(decimals) + (unit ? ' ' + unit : '');
    setter(v);
  });

  // Initialise display
  if (label) {
    label.textContent = parseFloat(slider.value).toFixed(decimals) + (unit ? ' ' + unit : '');
  }
}

bindSlider('voltage-slider', 'voltage-value', 'kV', 1, 100, 0, v => {
  system.config.voltage = v;
});

bindSlider('frequency-slider', 'frequency-value', 'kHz', 10, 500, 0, v => {
  system.config.frequency = v;
});

bindSlider('humidity-slider', 'humidity-value', '%', 0, 100, 0, v => {
  system.config.humidity = v;
  if (system.humidityModel) system.humidityModel.setRelativeHumidity(v / 100);
  // Rebuild corona with new humidity object
  if (system.initialized) {
    system.humidityModel.setRelativeHumidity(v / 100);
  }
});

bindSlider('eta-slider', 'eta-value', '', 0.5, 4.0, 2, v => {
  system.config.eta = v;
  if (system.dbm) system.dbm.setEta(v);
});

// Polarity toggle
const polarityBtn = document.getElementById('polarity-btn');
if (polarityBtn) {
  polarityBtn.addEventListener('click', () => {
    const next = system.config.polarity === 'positive' ? 'negative' : 'positive';
    system.config.polarity = next;
    polarityBtn.textContent = next.charAt(0).toUpperCase() + next.slice(1) + ' ⚡';
    polarityBtn.classList.toggle('negative', next === 'negative');
  });
}

// Reset button
const resetBtn = document.getElementById('reset-btn');
if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    // Clear streamers immediately for snappy feel
    system.streamers = [];
    system._spawnAccum = 0;
  });
}

// Full reinitialise button (re-solves field)
const reinitBtn = document.getElementById('reinit-btn');
if (reinitBtn) {
  reinitBtn.addEventListener('click', () => {
    showLoading(true);
    setTimeout(() => {
      system.config.width     = GRID_W;
      system.config.height    = GRID_H;
      system.config.eta       = parseFloat(document.getElementById('eta-slider')?.value || 2);
      system.config.humidity  = parseFloat(document.getElementById('humidity-slider')?.value || 50);
      system.config.voltage   = parseFloat(document.getElementById('voltage-slider')?.value || 50);
      system.config.frequency = parseFloat(document.getElementById('frequency-slider')?.value || 50);
      system.initialize();
      resizeCanvas();
      showLoading(false);
    }, 30);
  });
}

// ── Console-accessible exports ───────────────────────────────────────────────
export { system, renderer };
