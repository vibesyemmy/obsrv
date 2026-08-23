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
uniform float uSrcH;       // target viewport height, for the row flip
uniform float uBrightness;
uniform float uBlackFloor;
uniform float uGamut;
uniform float uLevels;
uniform float uDither;     // 0.0 or 1.0

out vec4 fragColor;

const float GAMMA = 2.2;

/** Must match bayer() in src/shared/panelSim.ts. */
float bayer4(ivec2 p) {
  float m[16] = float[16](
    0.0,  8.0,  2.0, 10.0,
   12.0,  4.0, 14.0,  6.0,
    3.0, 11.0,  1.0,  9.0,
   15.0,  7.0, 13.0,  5.0
  );
  return m[(p.y & 3) * 4 + (p.x & 3)] / 16.0;
}

void main() {
  // gl_FragCoord is bottom-up; the texture rows arrive top-down from Chromium.
  vec2 tp = floor(gl_FragCoord.xy / uScale);
  ivec2 t = ivec2(int(tp.x), int(uSrcH - 1.0 - tp.y));

  vec3 c = texelFetch(uTex, t, 0).bgr;

  c = pow(c, vec3(GAMMA));                          // to linear light
  c = uBrightness * (uBlackFloor + (1.0 - uBlackFloor) * c); // backlight × (black floor + signal)
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = vec3(l) + (c - vec3(l)) * uGamut;             // gamut coverage
  c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / GAMMA));   // encode

  float d = uDither * (bayer4(t) - 0.5);
  c = floor(c * uLevels + d + 0.5) / uLevels;       // bit depth (+ FRC)

  fragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}
`
