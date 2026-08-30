import { useShallow } from 'zustand/react/shallow'
import type { PanelProfile } from '../../../shared/types'
import { VISION_TYPES } from '../../../shared/vision'
import { selectHostNits, selectProfile, selectTab, useStore } from '../state/store'

/**
 * The top of the contrast slider means "no black lift": it commits
 * `contrastRatio: null`, exactly what the Reference profile carries, and the
 * readout says "off". It is the only slider with an off position. Brightness
 * is always an absolute nits figure in a custom profile — a preset's
 * `nits: null` ("same as host") is resolved against the host the moment the
 * sliders take over, so the hand-tuned panel never silently changes when the
 * host's nits setting does.
 */
export const CONTRAST_MAX = 3000

export const CUSTOM_PROFILE_ID = 'custom'

/** Slider positions, in the units a person thinks in. */
export interface PanelControlValues {
  nits: number
  contrast: number
  gamutPct: number
  bits: 6 | 8
  frc: boolean
}

export function profileToControls(p: PanelProfile, hostNits: number): PanelControlValues {
  return {
    nits: p.nits ?? hostNits,
    contrast: p.contrastRatio ?? CONTRAST_MAX,
    gamutPct: Math.round(p.gamutCoverage * 100),
    bits: p.bits,
    frc: p.frc,
  }
}

/**
 * The custom profile that results from moving the sliders from `base`. With
 * an empty patch it simulates identically to `base` (see the unit tests), so
 * the first slider touch changes only the one value moved.
 */
export function customProfile(
  base: PanelProfile,
  hostNits: number,
  patch: Partial<PanelControlValues>,
): PanelProfile {
  const c = { ...profileToControls(base, hostNits), ...patch }
  return {
    id: CUSTOM_PROFILE_ID,
    label: 'Custom panel',
    contrastRatio: c.contrast >= CONTRAST_MAX ? null : c.contrast,
    gamutCoverage: c.gamutPct / 100,
    bits: c.bits,
    frc: c.frc,
    nits: c.nits,
  }
}

/** A slider row in the inspector: label left, value pinned right in the mono face. */
function Slider({
  label,
  value,
  className,
  min,
  max,
  step,
  current,
  onChange,
}: {
  label: string
  value: string
  className: string
  min: number
  max: number
  step?: number
  current: number
  onChange: (v: number) => void
}) {
  return (
    <label className="control">
      <span className="control-row">
        <span>{label}</span>
        <span className="num">{value}</span>
      </span>
      <input
        className={className}
        type="range"
        min={min}
        max={max}
        step={step}
        value={current}
        aria-valuetext={value}
        onChange={e => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function PanelControls() {
  const profile = useStore(useShallow(selectProfile))
  const hostNits = useStore(selectHostNits)
  const setProfileOverride = useStore(s => s.setProfileOverride)

  const v = profileToControls(profile, hostNits)
  const update = (patch: Partial<PanelControlValues>): void =>
    setProfileOverride(customProfile(profile, hostNits, patch))

  return (
    <div className="controls">
      <h2>Panel</h2>
      <p className="muted">Approximation — not colourimetric.</p>

      <Slider
        label="Brightness"
        value={`${v.nits} nits`}
        className="nits-slider"
        min={50}
        // "Same as host" must always be reachable.
        max={Math.max(600, hostNits)}
        step={10}
        current={v.nits}
        onChange={nits => update({ nits })}
      />

      <Slider
        label="Contrast"
        value={v.contrast >= CONTRAST_MAX ? 'off' : `${v.contrast}:1`}
        className="contrast-slider"
        min={100}
        max={CONTRAST_MAX}
        step={50}
        current={v.contrast}
        onChange={contrast => update({ contrast })}
      />

      <Slider
        label="Gamut"
        value={`${v.gamutPct}% sRGB`}
        className="gamut-slider"
        min={0}
        max={100}
        current={v.gamutPct}
        onChange={gamutPct => update({ gamutPct })}
      />

      <label className="control">
        <span className="control-row">
          <span>Bit depth</span>
        </span>
        <select
          className="bits-select num"
          value={v.bits}
          onChange={e => update({ bits: Number(e.target.value) === 6 ? 6 : 8 })}
        >
          <option value={8}>8-bit</option>
          <option value={6}>6-bit</option>
        </select>
      </label>

      <label className="control inline">
        <input
          className="frc-check"
          type="checkbox"
          checked={v.frc}
          onChange={e => update({ frc: e.target.checked })}
        />
        <span>FRC dithering</span>
      </label>

      <p className="muted">Choosing a profile in the toolbar resets these.</p>

      <VisionControls />
    </div>
  )
}

/**
 * The viewer, kept apart from the panel above it.
 *
 * A panel profile is a *screen*; this is a *person*. Putting "Deutan" in the
 * profile list beside "Budget TN" would say they are the same kind of thing,
 * and they are not — you can have both at once, and the order matters: the
 * screen emits light, then the eye receives it.
 */
function VisionControls() {
  const type = useStore(s => selectTab(s).visionType)
  const severity = useStore(s => selectTab(s).visionSeverity)
  const setVision = useStore(s => s.setVision)
  const active = VISION_TYPES.find(t => t.id === type) ?? VISION_TYPES[0]!

  return (
    <>
      <h2>Vision</h2>
      <p className="muted">
        Simulated on the render, after the panel — the screen emits light, then
        the eye receives it.
      </p>

      <div className="vision-control" role="group" aria-label="Colour vision">
        {VISION_TYPES.map(t => (
          <button
            key={t.id}
            type="button"
            className={`vision-${t.id}`}
            title={t.note}
            aria-pressed={type === t.id}
            onClick={() => setVision(t.id, severity)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="muted vision-note">{active.note}</p>

      {/* Severity is the point, not a refinement: full dichromacy is the rare
          end. Deuteranomaly — partial, not absent — is what most people with a
          colour deficiency actually have, so a tool offering only the extreme
          would simulate the uncommon case and call it the common one. */}
      <Slider
        label="Severity"
        value={`${Math.round(severity * 100)}%`}
        className="vision-severity"
        min={10}
        max={100}
        step={10}
        current={Math.round(severity * 100)}
        onChange={pct => setVision(type, pct / 100)}
      />

      <p className="muted">
        Matrices from Machado et al. (2009) at full severity; the steps between
        are interpolated, so treat the middle as indicative rather than
        measured. A simulation answers “does this survive without that hue”. It
        does not replace a contrast check for text.
      </p>
    </>
  )
}
