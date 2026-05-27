# Kirlian Discharge Simulator

A real-time, physically-grounded simulation of **Kirlian (corona) discharge** rendered in the browser with Canvas 2D and pure JavaScript.

![Screenshot placeholder – run the simulator to see the live discharge](docs/screenshot-placeholder.png)

---

## Overview

Kirlian photography (named after Semyon Kirlian, 1939) records the corona discharge
that forms around a high-voltage electrode when a conductive or semi-conductive object
is placed on or near it.  The resulting images – glowing halos, branching filaments,
coloured auras around leaves and fingertips – have captivated scientists and artists
for decades.

This simulator reproduces the key physical mechanisms:

| Mechanism | Model used |
|---|---|
| Electrostatic field | 2-D Laplace equation, SOR solver |
| Discharge branching | Dielectric Breakdown Model (DBM) |
| Ionisation threshold | Townsend α/η_a coefficients for air |
| Humidity effects | Magnus vapour pressure + IEC k_v formula |
| Plasma colours | N₂ Second Positive & OH* molecular emission |
| AC pulsing | Full-wave rectified envelope at 2 × frequency |

---

## Quick Start

```bash
# Serve locally (no build step needed)
npx serve . -p 8080
# then open http://localhost:8080
```

Or with Vite for hot-reload during development:

```bash
npm install
npm run dev
```

The file `index.html` can also be opened directly in Chrome/Edge/Firefox without a
server (ES modules require `file://` CORS to be allowed, or use a local server).

---

## Controls

| Control | Range | Effect |
|---|---|---|
| **Voltage** | 1–100 kV | Peak AC voltage applied to leaf electrode. Higher → more streamers, longer reach |
| **Frequency** | 10–500 kHz | AC supply frequency. Affects corona pulse rate and visual rhythm |
| **Humidity** | 0–100 % | Relative humidity of surrounding air. High RH → more filaments, blue-white colour shift |
| **DBM η** | 0.5–4.0 | Branching exponent. Low η = diffuse DLA-like; high η = deterministic Lichtenberg |
| **Polarity** | +/− | Positive corona: narrow, less branched. Negative: wider angle, more diffuse |
| **Clear Streamers** | — | Remove active channels immediately |
| **Reinitialise Field** | — | Re-solve Laplace field with current parameters |

Live API (browser console):

```js
system.config.voltage = 80;         // change voltage immediately
system.dbm.setEta(3.5);             // change branching exponent
system.humidityModel.setRelativeHumidity(0.9);
```

---

## Physics Background

### 1 · Electrostatic Field (Laplace Solver)

The potential distribution φ in the air gap satisfies the Laplace equation:

```
∇²φ = 0   (free space)
∇·(ε∇φ) = 0  (with dielectric subject)
```

Boundary conditions:
- **Leaf / subject**: conductor held at V = 1 (normalised HV electrode)
- **Outer ring**: V = 0 (ground, represents the far field or photographic plate edge)

The solver uses **Successive Over-Relaxation (SOR)** with ω ≈ 1.85 (near-optimal for
a 160 × 120 grid).  Convergence is achieved in ≈ 300 iterations to residual < 10⁻⁵.

The electric field is recovered as **E = −∇φ** via central finite differences.

The reason Kirlian images reveal biological structure: inhomogeneities in tissue
permittivity (ε_r ≈ 40–80 for hydrated tissue vs. 1 for air) distort field lines
toward surface cusps and high-curvature features (veins, pores), concentrating the
field there and producing localised discharge features.

### 2 · Dielectric Breakdown Model (DBM)

Based on **Niemeyer, Pietronero & Wiesmann (1984)**.  The probability that a discharge
tip advances to neighbour cell i is:

```
P_i ∝ |E_i|^η × w_i
```

where |E_i| is the field magnitude at candidate position i, η is the branching
exponent (user-controllable), and w_i is a directional weight biasing growth outward
from the subject.

The theoretical fractal dimension of the resulting pattern is approximately:

```
D ≈ 2 − 1/(η + 1)
```

- η = 1: D ≈ 1.5  (DLA-like, highly branched)
- η = 2: D ≈ 1.67 (typical laboratory discharge)
- η = 4: D ≈ 1.80 (near-deterministic Lichtenberg figure)

### 3 · Townsend Ionisation (Air)

The **first Townsend ionisation coefficient** α(E) gives electron multiplication per
unit path length (Townsend empirical formula for air):

```
α = A·p·exp(−B·p/E)
```

where A = 12 cm⁻¹ torr⁻¹, B = 365 V cm⁻¹ torr⁻¹ (Raizer, 1991).

The **attachment coefficient** η_a(E) accounts for electron loss to O₂⁻ formation.

Net ionisation α − η_a > 0 is the condition for a self-sustaining avalanche.
The critical field is ≈ 30 kV/cm in dry air at STP.

**Meek's criterion** for streamer formation: α·d > 20 (10⁸ electrons generated).

### 4 · Humidity Model

Absolute humidity is derived from the **Magnus formula** for saturation vapour pressure.

Key effects of increasing humidity:
- **Lower breakdown voltage**: water vapour has lower ionisation potential → k_v < 1
  (IEC empirical: k_v ≈ 1 − 0.003·(AH − 11))
- **More filaments**: electronegativity of H₂O increases avalanche channel density
- **Colour shift**: OH* radical at 306 nm adds blue-violet component to emission
- **Diffuse glow**: three-body attachment quenching broadens the corona sheath

### 5 · Plasma Emission Colours

Colours are derived from molecular emission spectra of air plasma:

| Species | System | λ_peak | Colour |
|---|---|---|---|
| N₂ | Second Positive (C³Π → B³Π) | 315–380 nm | violet-purple |
| N₂⁺ | First Negative (B²Σ → X²Σ) | 391 nm | blue-violet |
| OH* | A²Σ → X²Π | 306–308 nm | UV (perceived blue-white) |
| O | Atomic lines | 777/844 nm | faint red tinge |

At low intensity: deep violet.  Medium: pink-purple.  High: white-pink (optically thick).

---

## Project Structure

```
kirlian_discharge/
├── index.html                 # Single-page app entry point
├── package.json
├── styles/
│   └── main.css               # Dark plasma-aesthetic UI
└── src/
    ├── main.js                # Entry point, animation loop, UI wiring
    ├── physics/
    │   ├── field_solver.js    # 2-D Laplace SOR solver
    │   ├── dielectric_breakdown.js  # DBM growth probabilities
    │   ├── ionization.js      # Townsend α/η_a coefficients
    │   └── humidity.js        # Humidity correction model
    ├── simulation/
    │   ├── discharge_system.js # Top-level orchestrator
    │   ├── streamer.js        # Individual discharge channel
    │   └── corona.js          # Diffuse boundary glow
    ├── rendering/
    │   ├── canvas_renderer.js # Multi-pass Canvas 2D renderer
    │   └── plasma_color.js    # Physics-based emission colours
    └── shaders/
        ├── field.glsl         # Reference WebGL2 Jacobi solver
        └── glow.glsl          # Reference Gaussian bloom shader
```

---

## Scientific vs Artistic Accuracy

This simulator prioritises **physically motivated behaviour** over exact quantitative
accuracy.  The SOR field solver and DBM are genuine physics algorithms.  The
Townsend/humidity/colour models use real empirical constants.  However:

- Grid resolution (160 × 120) is far below the micron-scale structure of real discharge
- The static field approximation (not re-solving after each streamer step) means the
  field enhancement at the advancing tip is approximated by a directional bias weight
- Streamer lengths are scaled to be visually dramatic rather than physically scaled
- Colours are rendered as visible-light equivalents of UV-dominated emission bands

For a scientifically rigorous simulation, see:
- Pancheshnyi et al., *Comput. Phys. Commun.* 178 (2008) – BOLSIG+ transport code
- Luque & Ebert, *Phys. Rev. E* 84 (2011) – streamer channel models

---

## References

1. Kirlian, S.D. & Kirlian, V.K. — *In the World of Wonderful Discharges* (1964)
2. Niemeyer, L., Pietronero, L. & Wiesmann, H.J. — *Fractal Dimension of Dielectric
   Breakdown*, Phys. Rev. Lett. **52**, 1033 (1984)
3. Townsend, J.S. — *Electricity in Gases*, Clarendon Press (1915)
4. Raizer, Y.P. — *Gas Discharge Physics*, Springer (1991)
5. Kuffel, E. & Zaengl, W.S. — *High Voltage Engineering Fundamentals*, Pergamon (2000)
6. Meek, J.M. & Craggs, J.D. — *Electrical Breakdown of Gases*, Wiley (1978)
7. Pearse, R.W.B. & Gaydon, A.G. — *Identification of Molecular Spectra* (4th ed., 1976)
8. Phelps, A.V. & Pitchford, L.C. — *Anisotropic scattering of electrons in N₂*,
   Phys. Rev. A **31**, 2932 (1985)

---

## Contributing

Contributions welcome:

- **WebGL2 port**: swap the JS SOR solver for the reference `field.glsl` Jacobi shader
  to enable real-time field re-solving at interactive rates
- **Streamer merging**: detect when two streamer tips converge and create a connecting
  discharge path with brightened flash
- **3-D extension**: voxel Laplace solver + volumetric ray-march renderer
- **Sound**: synthesise crackle/hiss using the streamer birth rate as modulation signal
- **Export**: record PNG frames or WebM video of discharge sequences

---

*"The corona discharge reveals what the eye cannot otherwise see — the field lines
made luminous by the violence of ionisation."*
