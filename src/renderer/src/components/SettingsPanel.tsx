import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ppi } from '../../../shared/calibration'
import type { Settings } from '../../../shared/types'
import {
  selectScale,
  selectScaleIsFallback,
  selectViewport,
  useStore,
} from '../state/store'

interface NumberFieldProps {
  className: string
  label: string
  unit: string
  value: number
  min: number
  step?: number
  /** Called only with a finite value of at least `min`. */
  onCommit: (v: number) => void
  /** Called with a message while the field holds something uncommittable, null once it is clean. */
  onInvalid: (message: string | null) => void
}

/**
 * A numeric field that keeps its own draft. Typing "2" on the way to "27"
 * must not commit a 2-inch display, and clearing the field must not commit
 * NaN — `ppi` throws on either and main refuses to store them. The draft
 * follows the store (a `getSettings` landing after mount, say) except while
 * the field is being edited, the same guard the URL bar uses.
 */
function NumberField({ className, label, unit, value, min, step, onCommit, onInvalid }: NumberFieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(String(value))
  }, [value])

  return (
    <label className="control">
      <span className="control-row">
        <span>{label}</span>
        <span>{unit}</span>
      </span>
      <input
        ref={ref}
        className={`${className} num`}
        type="number"
        min={min}
        step={step}
        value={draft}
        onChange={e => {
          const raw = e.target.value
          setDraft(raw)
          const n = Number(raw)
          if (raw.trim() === '' || !Number.isFinite(n) || n < min) {
            onInvalid(`${label} must be a number of at least ${min}.`)
            return
          }
          onInvalid(null)
          onCommit(n)
        }}
        onBlur={() => {
          // Leaving a half-typed field snaps it back to the last good value.
          setDraft(String(value))
          onInvalid(null)
        }}
      />
    </label>
  )
}

export function SettingsPanel() {
  const host = useStore(useShallow(s => s.host))
  const settings = useStore(useShallow(s => s.settings))
  const custom = useStore(useShallow(s => s.custom))
  const viewport = useStore(useShallow(selectViewport))
  const scale = useStore(selectScale)
  const fallback = useStore(selectScaleIsFallback)
  const setSettings = useStore(s => s.setSettings)
  const setCustom = useStore(s => s.setCustom)

  const [hostError, setHostError] = useState<string | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)

  const displayKnown = host.physicalWidth > 0 && host.physicalHeight > 0 && host.scaleFactor > 0
  const hostPpi =
    displayKnown && settings.hostDiagonalInches > 0
      ? ppi(host.physicalWidth, host.physicalHeight, settings.hostDiagonalInches)
      : null

  // Mirrors main's guard (`parseSettings`): anything not finite and positive
  // is refused there, and `ppi` would throw on it here. The store is updated
  // first so the panes follow the keystroke; a refusal from main rolls it back
  // and says so, rather than leaving the panes showing an unsaved value.
  const commit = async (next: Settings): Promise<void> => {
    if (!(next.hostDiagonalInches > 0) || !(next.hostNits > 0)) return
    const prev = settings
    setSettings(next)
    try {
      await window.obsrv.setSettings(next)
    } catch (e) {
      setSettings(prev)
      setHostError(`Not saved: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const error = (message: string | null) =>
    message ? <p className="field-error" role="alert">{message}</p> : null

  return (
    <div className="controls">
      <h2>This display</h2>

      {fallback && (
        <p className="warn">
          Display information unavailable — falling back to a flat 2× magnification.
        </p>
      )}

      <NumberField
        className="host-diagonal"
        label="Diagonal"
        unit="in"
        value={settings.hostDiagonalInches}
        min={5}
        step={0.1}
        onCommit={v => void commit({ ...settings, hostDiagonalInches: v })}
        onInvalid={setHostError}
      />

      <NumberField
        className="host-nits"
        label="Peak brightness"
        unit="nits"
        value={settings.hostNits}
        min={50}
        step={10}
        onCommit={v => void commit({ ...settings, hostNits: v })}
        onInvalid={setHostError}
      />

      {error(hostError)}

      <p className="readout">
        {displayKnown
          ? `${host.physicalWidth}×${host.physicalHeight} px · ×${host.scaleFactor}`
          : 'host unknown'}
        {hostPpi !== null ? ` · ${hostPpi.toFixed(0)} PPI` : ''}
        <br />
        magnification ×{scale.toFixed(3)}
      </p>

      <h2>Custom screen</h2>
      <p className="muted">Editing these selects the Custom preset.</p>

      <NumberField
        className="custom-width"
        label="Width"
        unit="px"
        value={custom.width}
        min={1}
        onCommit={width => setCustom({ width })}
        onInvalid={setCustomError}
      />

      <NumberField
        className="custom-height"
        label="Height"
        unit="px"
        value={custom.height}
        min={1}
        onCommit={height => setCustom({ height })}
        onInvalid={setCustomError}
      />

      <NumberField
        className="custom-diagonal"
        label="Diagonal"
        unit="in"
        value={custom.diagonalInches}
        min={5}
        step={0.1}
        onCommit={diagonalInches => setCustom({ diagonalInches })}
        onInvalid={setCustomError}
      />

      {error(customError)}

      {viewport.clamped && (
        <p className="warn">
          Viewport clamped to {viewport.width}×{viewport.height}.
        </p>
      )}

      <p className="readout">
        {custom.diagonalInches > 0
          ? `${ppi(custom.width, custom.height, custom.diagonalInches).toFixed(0)} PPI`
          : 'Enter a diagonal to compute PPI'}
      </p>
    </div>
  )
}
