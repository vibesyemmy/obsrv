/**
 * Colour-vision simulation, as a 3×3 matrix applied to linear light.
 *
 * This is a *viewer* stage, not a panel stage: the display emits light and the
 * eye receives it, so it belongs after everything the panel does — including
 * the bit-depth quantisation. Applying it earlier would quantise the eye's
 * output, which is backwards.
 *
 * The matrices are Machado, Oliveira & Fernandes (2009), "A Physiologically-
 * based Model for Simulation of Color Vision Deficiency", at severity 1.0 —
 * the dichromat end.
 *
 * Intermediate severities are interpolated from identity rather than read from
 * that paper's tabulated 0.1 steps. The paper's own steps are not exactly
 * linear, so this is an approximation, and it is the one worth being explicit
 * about: it is closest at the ends (identity and full dichromacy are exact) and
 * loosest in the middle, which is where anomalous trichromacy actually lives.
 * It is good enough to answer "does this UI survive without that hue channel",
 * which is the question the control exists for; it is not good enough to
 * publish as a perceptual measurement.
 */

/** What the simulation is standing in for. `none` is the identity. */
export type VisionType = 'none' | 'protan' | 'deutan' | 'tritan' | 'achromat'

export const VISION_TYPES: { id: VisionType; label: string; note: string }[] = [
  { id: 'none', label: 'Normal', note: 'No simulation' },
  { id: 'protan', label: 'Protan', note: 'Red-weak: reds look darker as well as shifted' },
  { id: 'deutan', label: 'Deutan', note: 'Green-weak: the most common colour vision deficiency' },
  { id: 'tritan', label: 'Tritan', note: 'Blue and yellow confused: rare, and hard on blue palettes' },
  { id: 'achromat', label: 'Achromat', note: 'No colour at all: the strongest test of anything that relies on colour alone' },
]

/** Row-major 3×3, applied to linear RGB. */
export type Matrix3 = readonly [number, number, number, number, number, number, number, number, number]

const IDENTITY: Matrix3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** Machado et al. 2009, severity 1.0. */
const FULL: Record<Exclude<VisionType, 'none' | 'achromat'>, Matrix3> = {
  protan: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
  deutan: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  tritan: [1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039],
}

/**
 * Rec.709 luminance, in linear light — the same weights the panel simulation
 * already uses for its gamut stage, so "no hue" here means the same grey that
 * a fully desaturated panel would produce.
 */
const LUMA: Matrix3 = [0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722, 0.2126, 0.7152, 0.0722]

/** Severity outside 0..1 is a caller bug, not a state to render; clamped. */
const clampSeverity = (s: number): number => (Number.isFinite(s) ? Math.min(1, Math.max(0, s)) : 0)

/**
 * The matrix for a type at a severity. `none`, and any type at severity 0,
 * gives the identity — so the shader has one code path and the "off" case
 * costs a multiply rather than a branch.
 */
export function visionMatrix(type: VisionType, severity: number): Matrix3 {
  const s = clampSeverity(severity)
  if (type === 'none' || s === 0) return IDENTITY
  const target = type === 'achromat' ? LUMA : FULL[type]
  if (s === 1) return target
  return IDENTITY.map((v, i) => v + (target[i]! - v) * s) as unknown as Matrix3
}

/** Applies a matrix to one linear-light RGB triple. Values are not clamped
 *  here: the caller clamps once, after any further stages. */
export function applyMatrix(m: Matrix3, r: number, g: number, b: number): [number, number, number] {
  return [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ]
}

/** True when the stage would change nothing, for the readouts that must say so. */
export function visionIsIdentity(type: VisionType, severity: number): boolean {
  return type === 'none' || clampSeverity(severity) === 0
}

/** Narrows an unknown to a `VisionType`, for the payload parsers. */
export function isVisionType(v: unknown): v is VisionType {
  return VISION_TYPES.some(t => t.id === v)
}
