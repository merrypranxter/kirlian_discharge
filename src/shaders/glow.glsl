// ============================================================
// glow.glsl  –  Two-pass separable Gaussian blur for bloom
//
// This post-process shader is applied after the plasma scene
// is rendered to a floating-point render target.  The result
// is composited back onto the scene with additive blending to
// simulate camera-lens bloom around bright plasma channels.
//
// Pass 0 (horizontal):  u_horizontal = 1
// Pass 1 (vertical):    u_horizontal = 0
//
// The kernel uses a 13-tap Gaussian with σ = 3.5 px which
// produces a tight, physically plausible bloom radius.
// Larger σ can be achieved by running multiple passes.
// ============================================================

#version 300 es
precision mediump float;

uniform sampler2D u_scene;       // source: rendered plasma frame
uniform vec2      u_resolution;  // viewport size in pixels
uniform float     u_horizontal;  // 1 = horizontal pass, 0 = vertical
uniform float     u_threshold;   // luminance threshold for bloom extraction
uniform float     u_strength;    // bloom mix weight (0 = off, 1 = full)

in  vec2 v_uv;
out vec4 fragColor;

// ── Luminance helper ─────────────────────────────────────────
float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

// ── 13-tap Gaussian weights (σ ≈ 3.5) ───────────────────────
// Weights are symmetric; indices 0–6 represent offsets 0..6.
const float WEIGHTS[7] = float[7](
  0.1995,   // offset 0  (centre)
  0.1760,   // offset ±1
  0.1210,   // offset ±2
  0.0648,   // offset ±3
  0.0270,   // offset ±4
  0.0088,   // offset ±5
  0.0022    // offset ±6
);

void main() {
  vec2 texelSize = 1.0 / u_resolution;
  vec4 srcColor  = texture(u_scene, v_uv);

  // Extract only pixels brighter than the threshold
  float lum = luminance(srcColor.rgb);
  if (lum < u_threshold) {
    // Below threshold: pass through un-bloomed scene colour
    fragColor = srcColor;
    return;
  }

  // Direction vector for the current pass
  vec2 dir = u_horizontal > 0.5
    ? vec2(texelSize.x, 0.0)
    : vec2(0.0, texelSize.y);

  // Weighted accumulation
  vec4 result = srcColor * WEIGHTS[0];

  for (int i = 1; i < 7; i++) {
    float offset = float(i);
    vec2  off    = dir * offset;

    vec4 samplePos = texture(u_scene, v_uv + off);
    vec4 sampleNeg = texture(u_scene, v_uv - off);

    result += (samplePos + sampleNeg) * WEIGHTS[i];
  }

  // Additive blend: bloom is pure light energy addition
  fragColor = srcColor + result * u_strength;
}

// ── Vertex shader (companion – included as comment) ──────────
//
// #version 300 es
// in  vec2 a_position;  // full-screen quad [-1,1]
// out vec2 v_uv;
// void main() {
//   v_uv        = a_position * 0.5 + 0.5;
//   gl_Position = vec4(a_position, 0.0, 1.0);
// }
