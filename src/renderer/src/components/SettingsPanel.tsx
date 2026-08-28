import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ppi } from '../../../shared/calibration'
import { MAX_TABS_MAX, MAX_TABS_MIN } from '../../../shared/presets'
import { formatAge } from '../../../shared/update'
import type { Settings } from '../../../shared/types'
import {
  selectScale,
  selectScaleIsFallback,
  selectTab,
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
  /** Called on blur or Enter, only with a finite value of at least `min`. */
  onCommit: (v: number) => void
  /** Called with a message when blur or Enter finds the draft uncommittable, null once one commits. */
  onInvalid: (message: string | null) => void
}

/**
 * A numeric field that commits on blur or Enter, never on a keystroke:
 * typing "54" must not pass through a 5-inch display, and clearing the field
 * must not commit NaN — `ppi` throws on either and main refuses to store
 * them. Escape reverts to the store's value. The draft follows the store (a
 * `getSettings` landing after mount, say) except while the field is being
 * edited, the same guard the URL bar uses.
 */
function NumberField({ className, label, unit, value, min, step, onCommit, onInvalid }: NumberFieldProps) {
  const ref = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(value))

  useEffect(() => {
    if (document.activeElement !== ref.current) setDraft(String(value))
  }, [value])

  // Returns whether the draft was committed. An uncommittable draft reports
  // why; the caller decides whether to keep it on screen.
  const commit = (): boolean => {
    const n = Number(draft)
    if (draft.trim() === '' || !Number.isFinite(n) || n < min) {
      onInvalid(`${label} must be a number of at least ${min}.`)
      return false
    }
    onInvalid(null)
    if (n !== value) onCommit(n)
    return true
  }

  const revert = (): void => {
    setDraft(String(value))
    onInvalid(null)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    // Enter keeps focus and, if the draft was bad, keeps it too so it can be fixed.
    if (e.key === 'Enter') commit()
    else if (e.key === 'Escape') revert()
  }

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
        onChange={e => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        // Leaving a field never leaves it showing an uncommitted value.
        onBlur={() => {
          if (!commit()) setDraft(String(value))
        }}
      />
    </label>
  )
}

export function SettingsPanel() {
  const host = useStore(useShallow(s => s.host))
  const settings = useStore(useShallow(s => s.settings))
  const update = useStore(s => s.update)
  const history = useStore(s => s.history)
  const custom = useStore(useShallow(s => selectTab(s).custom))
  const viewport = useStore(useShallow(selectViewport))
  const scale = useStore(selectScale)
  const fallback = useStore(selectScaleIsFallback)
  const setSettings = useStore(s => s.setSettings)
  const setCustom = useStore(s => s.setCustom)

  const [hostError, setHostError] = useState<string | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)

  // Settings commits are serialised through this chain, so their rejections
  // arrive in commit order and an earlier one cannot undo a later success.
  // `confirmed` is the last value main accepted (or the one it loaded), which
  // is what a rejection rolls back to; `pending` stops the store's optimistic
  // value from being mistaken for a confirmed one.
  const queue = useRef<Promise<void>>(Promise.resolve())
  const confirmed = useRef<Settings>(settings)
  const pending = useRef(0)
  useEffect(() => {
    if (pending.current === 0) confirmed.current = settings
  }, [settings])

  // Mirrors main's guard (`parseSettings`): anything not finite and positive
  // is refused there, and `ppi` would throw on it here. The store is updated
  // first so the panes follow the commit; a refusal from main rolls it back
  // and says so, rather than leaving the panes showing an unsaved value.
  const commit = (next: Settings): void => {
    if (!(next.hostDiagonalInches > 0) || !(next.hostNits > 0)) return
    pending.current++
    setSettings(next)
    const run = async (): Promise<void> => {
      try {
        await window.obsrv.setSettings(next)
        confirmed.current = next
      } catch (e) {
        // Only this commit's own value is rolled back; a later commit that has
        // already replaced it in the store owns the store now.
        if (useStore.getState().settings === next) setSettings(confirmed.current)
        setHostError(`Not saved: ${e instanceof Error ? e.message : String(e)}`)
      } finally {
        pending.current--
      }
    }
    queue.current = queue.current.then(run, run)
  }

  const displayKnown = host.physicalWidth > 0 && host.physicalHeight > 0 && host.scaleFactor > 0
  const hostPpi =
    displayKnown && settings.hostDiagonalInches > 0
      ? ppi(host.physicalWidth, host.physicalHeight, settings.hostDiagonalInches)
      : null

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
        onCommit={v => commit({ ...useStore.getState().settings, hostDiagonalInches: v })}
        onInvalid={setHostError}
      />

      <NumberField
        className="host-nits"
        label="Peak brightness"
        unit="nits"
        value={settings.hostNits}
        min={50}
        step={10}
        onCommit={v => commit({ ...useStore.getState().settings, hostNits: v })}
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

      <h2>Updates</h2>

      <div className="version-block">
        <div className="version-row">
          <span>Version</span>
          <span className="version-current num">{update?.current ?? '—'}</span>
        </div>
        <div className="version-row">
          <span>Latest</span>
          <span className="version-latest">
            {update === null && 'Not checked yet'}
            {update?.status === 'current' && update.checkedAt === 0 && 'Not checked yet'}
            {update?.status === 'current' && update.checkedAt > 0 && 'Up to date'}
            {update?.status === 'error' && 'Couldn’t check'}
            {update?.status === 'available' && update.latest !== undefined && (
              <>
                <span className="num">{update.latest}</span>
                {' · '}
                <button type="button" className="link" onClick={() => void window.obsrv.openRelease()}>
                  Download
                </button>
              </>
            )}
          </span>
        </div>
        <div className="version-row">
          <span>Last checked</span>
          <span className="version-checked num">
            {update === null ? 'never' : formatAge(update.checkedAt, Date.now())}
          </span>
        </div>
      </div>

      <label className="control inline update-check-toggle">
        <input
          type="checkbox"
          checked={settings.updateCheck}
          onChange={e => commit({ ...settings, updateCheck: e.target.checked })}
        />
        <span>Check for updates automatically</span>
      </label>

      <button type="button" className="check-now" onClick={() => void window.obsrv.checkUpdate()}>
        Check now
      </button>

      <p className="muted">
        One unauthenticated request to GitHub, at most once a day. No identifiers are sent.
      </p>

      <h2>Tabs</h2>

      <NumberField
        className="max-tabs"
        label="Maximum tabs"
        unit="tabs"
        value={settings.maxTabs}
        min={MAX_TABS_MIN}
        step={1}
        // Rounded and clamped here rather than sent and refused: main's
        // `parseSettings` rejects a fractional or out-of-band cap outright, and
        // a field the user can type into is the wrong place to learn that.
        onCommit={v =>
          commit({
            ...useStore.getState().settings,
            maxTabs: Math.min(MAX_TABS_MAX, Math.max(MAX_TABS_MIN, Math.round(v))),
          })
        }
        onInvalid={setHostError}
      />

      <p className="muted">
        Each tab is two Chromium processes — a live pane and an offscreen render — so
        the cap is a memory decision, not a preference. Lowering it never closes a tab
        that is already open; it only stops new ones.
      </p>

      <h2>History</h2>

      <label className="control inline record-history-toggle">
        <input
          type="checkbox"
          checked={settings.recordHistory}
          onChange={e => commit({ ...settings, recordHistory: e.target.checked })}
        />
        <span>Remember visited addresses</span>
      </label>

      <button
        type="button"
        className="clear-history"
        disabled={history.length === 0}
        onClick={() => void window.obsrv.clearHistory()}
      >
        Clear history
      </button>

      <p className="readout">
        <span className="history-count num">{history.length}</span>
        {history.length === 1 ? ' address remembered' : ' addresses remembered'}
      </p>

      <p className="muted">
        Typed into the URL bar as suggestions and nowhere else. Turning this off stops
        recording and keeps what is stored; Clear erases it.
      </p>
    </div>
  )
}
