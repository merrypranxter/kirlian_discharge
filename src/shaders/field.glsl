// ============================================================
// field.glsl  –  GPU-accelerated Laplace field solver
//
// Reference implementation for a WebGL2 compute pass.
// Currently the JavaScript SOR solver is used instead, but
// this shader can replace it for real-time dynamic re-solving
// at interactive rates on GPUs.
//
// Usage:
//   Each ping-pong pass reads `u_phi` and writes an updated
//   φ texture.  After convergence the renderer samples the
//   texture to obtain potential and field vectors.
//
// Texture layout:
//   R channel  –  potential φ ∈ [0, 1]
//   G channel  –  mask  (0 = free, 1 = electrode, 2 = dielectric)
//   B channel  –  permittivity ε_r (normalised, 1 = air)
//   A channel  –  boundary value (φ_fixed for electrode cells)
// ============================================================

#version 300 es
precision highp float;

uniform sampler2D u_phi;        // current potential + mask texture
uniform vec2      u_resolution; // texture dimensions (width, height)

out vec4 fragColor;

// Fetch one texel by integer grid coordinate, clamping to border.
vec4 fetch(ivec2 coord) {
  ivec2 sz = ivec2(u_resolution);
  coord    = clamp(coord, ivec2(0), sz - 1);
  return texelFetch(u_phi, coord, 0);
}

void main() {
  ivec2 coord = ivec2(gl_FragCoord.xy);
  vec4  here  = fetch(coord);

  float phi_here = here.r;
  float mask     = here.g;        // 0=free, 1=electrode, 2=dielectric
  float eps_here = max(1.0, here.b * 100.0); // denormalise ε_r
  float boundary = here.a;        // fixed voltage for electrode cells

  // ── Electrode: Dirichlet BC – hold fixed ──────────────────
  if (mask >= 0.9) {
    fragColor = vec4(boundary, mask, here.b, boundary);
    return;
  }

  // ── Free space: standard Jacobi stencil ───────────────────
  //   φ_new = 0.25 × (φ_left + φ_right + φ_up + φ_down)
  if (mask < 0.1) {
    float left  = fetch(coord + ivec2(-1,  0)).r;
    float right = fetch(coord + ivec2( 1,  0)).r;
    float up    = fetch(coord + ivec2( 0,  1)).r;
    float down  = fetch(coord + ivec2( 0, -1)).r;

    float phi_new = 0.25 * (left + right + up + down);
    fragColor = vec4(phi_new, mask, here.b, here.a);
    return;
  }

  // ── Dielectric: permittivity-weighted harmonic mean ────────
  //   Derived from ∇·(ε∇φ) = 0 with interface conditions.
  //   φ_new = Σ w_i·φ_i / Σ w_i,  w_i = 2·ε_here·ε_i / (ε_here + ε_i)
  vec4  nL = fetch(coord + ivec2(-1,  0));
  vec4  nR = fetch(coord + ivec2( 1,  0));
  vec4  nU = fetch(coord + ivec2( 0,  1));
  vec4  nD = fetch(coord + ivec2( 0, -1));

  float epsL = max(1.0, nL.b * 100.0);
  float epsR = max(1.0, nR.b * 100.0);
  float epsU = max(1.0, nU.b * 100.0);
  float epsD = max(1.0, nD.b * 100.0);

  float wL = 2.0 * eps_here * epsL / (eps_here + epsL);
  float wR = 2.0 * eps_here * epsR / (eps_here + epsR);
  float wU = 2.0 * eps_here * epsU / (eps_here + epsU);
  float wD = 2.0 * eps_here * epsD / (eps_here + epsD);

  float wSum   = wL + wR + wU + wD;
  float phi_new = (wL * nL.r + wR * nR.r + wU * nU.r + wD * nD.r) / wSum;

  fragColor = vec4(phi_new, mask, here.b, here.a);
}
