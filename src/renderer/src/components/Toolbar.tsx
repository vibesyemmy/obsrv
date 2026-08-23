import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PANEL_PROFILES, SCREEN_PRESETS } from '../../../shared/presets'
import {
  CUSTOM_PRESET_ID,
  selectUrlBarText,
  selectViewport,
  useStore,
  type Surround,
} from '../state/store'

/** The neutral field the panes sit in — see the UI style spec. */
const SURROUNDS: { id: Surround; label: string; swatch: string }[] = [
  { id: 'black', label: 'Black surround', swatch: '#000000' },
  { id: 'graphite', label: 'Graphite surround', swatch: '#2a2a2a' },
  { id: 'grey50', label: 'Neutral 50% surround', swatch: '#808080' },
]

export function Toolbar() {
  const mode = useStore(s => s.mode)
  const presetId = useStore(s => s.presetId)
  const profileId = useStore(s => s.profileId)
  const pixelExact = useStore(s => s.pixelExact)
  const error = useStore(s => s.error)
  const loading = useStore(s => s.targetLoading)
  const barText = useStore(selectUrlBarText)
  const viewport = useStore(useShallow(selectViewport))

  const setUrl = useStore(s => s.setUrl)
  const setPreset = useStore(s => s.setPreset)
  const setProfile = useStore(s => s.setProfile)
  const setPixelExact = useStore(s => s.setPixelExact)
  const setError = useStore(s => s.setError)
  const surround = useStore(s => s.surround)
  const setSurround = useStore(s => s.setSurround)

  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(barText)

  // The bar follows the panes — a click in the native pane, a redirect, a
  // back — except while the user is typing in it: an `onUrlChanged` landing
  // mid-edit must not clobber the draft. Escape discards the edit.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(barText)
  }, [barText])

  // Spec §7: the URL bar shows the filename, read-only, while in image mode.
  const readOnly = mode === 'image'

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (readOnly || draft.trim() === '') return
    setError(null)
    const applied = await window.obsrv.navigate(draft)
    setUrl(applied)
    // The input keeps focus through Enter, so the sync above would skip it.
    setDraft(applied)
  }

  return (
    <div className="toolbar">
      <button type="button" title="Back" onClick={() => window.obsrv.back()}>
        ‹
      </button>
      <button type="button" title="Forward" onClick={() => window.obsrv.forward()}>
        ›
      </button>
      <button type="button" title="Reload" onClick={() => window.obsrv.reload()}>
        ⟳
      </button>

      <form className="url-form" onSubmit={submit}>
        <input
          ref={inputRef}
          value={draft}
          readOnly={readOnly}
          spellCheck={false}
          placeholder="Enter a URL, or drop a PNG"
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') setDraft(barText)
          }}
        />
      </form>

      {loading && <span className="muted">loading…</span>}
      {error && (
        <span className="badge-error" title={error.description}>
          {error.code}
        </span>
      )}

      <select
        className="preset-select"
        value={presetId}
        onChange={e => setPreset(e.target.value)}
      >
        {SCREEN_PRESETS.map(p => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value={CUSTOM_PRESET_ID}>Custom</option>
      </select>

      {viewport.clamped && (
        <span className="warn">
          clamped to {viewport.width}×{viewport.height}
        </span>
      )}

      <select
        className="profile-select"
        value={profileId}
        onChange={e => setProfile(e.target.value)}
      >
        {PANEL_PROFILES.map(p => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
      </select>

      <label className="pixel-exact">
        <input
          type="checkbox"
          checked={pixelExact}
          onChange={e => setPixelExact(e.target.checked)}
        />
        Pixel-exact
      </label>

      <div className="surround-control" role="group" aria-label="Pane surround">
        {SURROUNDS.map(s => (
          <button
            key={s.id}
            type="button"
            title={s.label}
            aria-label={s.label}
            aria-pressed={surround === s.id}
            onClick={() => setSurround(s.id)}
          >
            <span className="surround-swatch" style={{ background: s.swatch }} />
          </button>
        ))}
      </div>
    </div>
  )
}
