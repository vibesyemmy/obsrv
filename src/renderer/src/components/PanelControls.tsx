import { useShallow } from 'zustand/react/shallow'
import { DEFAULT_SETTINGS } from '../../../shared/presets'
import type { PanelParams } from '../../../shared/types'
import { selectPanelParams, useStore } from '../state/store'

/** The top of the contrast slider means "no black lift", i.e. blackFloor 0. */
export const CONTRAST_MAX = 3000

export interface PanelControlValues {
  nits: number
  contrast: number
  gamutPct: number
  bits: 6 | 8
  frc: boolean
}

export function paramsToControls(p: PanelParams, hostNits: number): PanelControlValues {
  return {
    nits: Math.round(p.brightness * hostNits),
    contrast: p.blackFloor <= 0 ? CONTRAST_MAX : Math.round(1 / p.blackFloor),
    gamutPct: Math.round(p.gamut * 100),
    bits: p.levels <= 63 ? 6 : 8,
    frc: p.dither,
  }
}

export function controlsToParams(c: PanelControlValues, hostNits: number): PanelParams {
  return {
    brightness: c.nits / hostNits,
    blackFloor: c.contrast >= CONTRAST_MAX ? 0 : 1 / c.contrast,
    gamut: c.gamutPct / 100,
    levels: 2 ** c.bits - 1,
    dither: c.frc,
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
        onChange={e => onChange(Number(e.target.value))}
      />
    </label>
  )
}

export function PanelControls() {
  const params = useStore(useShallow(selectPanelParams))
  // Mirrors `selectPanelParams`: a non-positive nits must not divide to Infinity.
  const hostNits = useStore(s =>
    s.settings.hostNits > 0 ? s.settings.hostNits : DEFAULT_SETTINGS.hostNits,
  )
  const setParamsOverride = useStore(s => s.setParamsOverride)

  const v = paramsToControls(params, hostNits)
  const update = (patch: Partial<PanelControlValues>): void =>
    setParamsOverride(controlsToParams({ ...v, ...patch }, hostNits))

  return (
    <div className="controls">
      <h2>Panel</h2>
      <p className="muted">Approximation — not colourimetric.</p>

      <Slider
        label="Brightness"
        value={`${v.nits} nits`}
        className="nits-slider"
        min={50}
        // The reference profile is "same as host", which must always be reachable.
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
    </div>
  )
}
