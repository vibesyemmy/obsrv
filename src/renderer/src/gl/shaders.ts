/**
 * Fullscreen triangle from `gl_VertexID` alone — no vertex buffers, no
 * attributes. Vertices 0,1,2 map to (-1,-1), (3,-1), (-1,3).
 */
export const VERT_SRC = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`

/**
 * Nearest upscale by uScale, then the panel simulation.
 *
 * The pipeline is a line-for-line port of `simulatePixel` in
 * `src/shared/panelSim.ts`; the browser test asserts they agree. Change one
 * and you must change the other.
 *
 * The texture holds the target's BGRA bytes uploaded verbatim, hence `.bgr`.
 */
export const FRAG_SRC = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uTex;
uniform float uScale;      // host pixels per target pixel
uniform float uCanvasH;    // backing-store height in host pixels, for the row flip
uniform ivec2 uSrcSize;    // target viewport size, for edge clamping
uniform float uBrightness;
uniform float uBlackFloor;
uniform float uGamut;
uniform float uLevels;
uniform float uDither;     // 0.0 or 1.0
uniform float uSmooth;     // 0.0 = texelFetch (bit-exact), 1.0 = mipmapped texture()
uniform mat3 uVision;      // colour-vision matrix, identity when off

out vec4 fragColor;

const float GAMMA = 2.2;

/** Must match BAYER4 in src/shared/panelSim.ts. */
const float BAYER[16] = float[16](
   0.0,  8.0,  2.0, 10.0,
  12.0,  4.0, 14.0,  6.0,
   3.0, 11.0,  1.0,  9.0,
  15.0,  7.0, 13.0,  5.0
);

float bayer4(ivec2 p) {
  return BAYER[(p.y & 3) * 4 + (p.x & 3)] / 16.0;
}

void main() {
  // gl_FragCoord is bottom-up; the texture rows arrive top-down from Chromium.
  // Flip into host space first so both axes are anchored at the top-left, then
  // divide: for a fractional uScale the partial target pixel lands on the
  // right/bottom edge, never the left/top. Clamp so the n.5 rounding of the
  // canvas size cannot fetch one texel past the edge.
  vec2 host = vec2(gl_FragCoord.x, uCanvasH - gl_FragCoord.y);
  ivec2 t = ivec2(floor(host / uScale));
  t = clamp(t, ivec2(0), max(uSrcSize - 1, ivec2(0)));

  // The smooth path is fit mode's: nearest decimation at a small fraction
  // moirés, so it samples with normalized coordinates through the sampler's
  // LINEAR_MIPMAP_LINEAR filter instead (CLAMP_TO_EDGE absorbs the fraction
  // of a texel the n.5 canvas rounding can overshoot by). The exact path is
  // bit-identical to v1, and the panel simulation below runs on the sampled
  // colour either way.
  vec3 c;
  if (uSmooth > 0.5) {
    c = texture(uTex, host / (uScale * vec2(uSrcSize))).bgr;
  } else {
    c = texelFetch(uTex, t, 0).bgr;
  }

  c = pow(c, vec3(GAMMA));                          // to linear light
  c = uBrightness * (uBlackFloor + (1.0 - uBlackFloor) * c); // backlight × (black floor + signal)
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = vec3(l) + (c - vec3(l)) * uGamut;             // gamut coverage
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / GAMMA));   // encode

  float d = uDither * (bayer4(t) - 0.5);
  c = floor(c * uLevels + d + 0.5) / uLevels;       // bit depth (+ FRC)

  // The viewer, after the display: everything above is what the panel emits,
  // and this is the eye receiving it. Back to linear, because the matrix models
  // cone response and acts on light, not on encoded values. Identity when the
  // simulation is off, so there is one path rather than a branch.
  c = pow(clamp(c, 0.0, 1.0), vec3(GAMMA));
  c = uVision * c;
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / GAMMA));

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`
