import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PANEL_PROFILES, SCREEN_PRESETS } from '../../../shared/presets'
import {
  CUSTOM_PRESET_ID,
  selectUrlBarText,
  selectViewport,
  useStore,
  type Panes,
  type Surround,
  type ViewMode,
} from '../state/store'
import { Icon } from './Icon'
import { OverflowMenu } from './OverflowMenu'
import { Segmented } from './Segmented'
import { Select } from './Select'

/** The neutral field the panes sit in — see the UI style spec. */
const SURROUNDS: { id: Surround; label: string; swatch: string }[] = [
  { id: 'black', label: 'Black surround', swatch: '#000000' },
  { id: 'graphite', label: 'Graphite surround', swatch: '#2a2a2a' },
  { id: 'grey50', label: 'Neutral 50% surround', swatch: '#808080' },
]

/** The target-pane view control. Fit is an overview, so its label says so. */
const VIEWS: { id: ViewMode; label: string; title: string }[] = [
  { id: '1:1', label: '1:1', title: 'Actual size' },
  { id: 'fit', label: 'Fit', title: 'Fit the pane — not pixel-exact' },
]

/** Native-only is not offered: that is a browser, and the user has one. */
const PANES: { id: Panes; label: string; title: string }[] = [
  { id: 'both', label: 'Both', title: 'Native and target side by side' },
  { id: 'target', label: 'Target', title: 'The target render alone, full width' },
]

export type Drawer = 'none' | 'panel' | 'settings'

export interface ToolbarProps {
  /** Which drawer is open, so its button can show as pressed. */
  drawer: Drawer
  onTogglePanel: () => void
  onToggleSettings: () => void
}

export function Toolbar({ drawer, onTogglePanel, onToggleSettings }: ToolbarProps) {
  const mode = useStore(s => s.mode)
  const presetId = useStore(s => s.presetId)
  const profileId = useStore(s => s.profileId)
  const pixelExact = useStore(s => s.pixelExact)
  const error = useStore(s => s.error)
  const loading = useStore(s => s.targetLoading)
  const barText = useStore(selectUrlBarText)
  const viewport = useStore(useShallow(selectViewport))

  const setUrl = useStore(s => s.setUrl)
  const setMode = useStore(s => s.setMode)
  const setPreset = useStore(s => s.setPreset)
  const setProfile = useStore(s => s.setProfile)
  const setPixelExact = useStore(s => s.setPixelExact)
  const setError = useStore(s => s.setError)
  const surround = useStore(s => s.surround)
  const update = useStore(s => s.update)
  const setSurround = useStore(s => s.setSurround)
  const viewMode = useStore(s => s.viewMode)
  const setViewMode = useStore(s => s.setViewMode)
  const panes = useStore(s => s.panes)
  const setPanes = useStore(s => s.setPanes)
  const agentControl = useStore(s => s.settings.agentControl)
  const setSettings = useStore(s => s.setSettings)

  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(barText)

  // Lit while an authenticated agent-control command arrived in the last ~3 s,
  // so the user can see the visible app is being driven.
  const [agentActive, setAgentActive] = useState(false)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.obsrv.onAgentActivity(() => {
      setAgentActive(true)
      clearTimeout(timer)
      timer = setTimeout(() => setAgentActive(false), 3000)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [])

  // The toggle owns the whole flip: optimistic store update so the button
  // answers immediately, rolled back if main refuses the write (mirrors the
  // SettingsPanel commit path, minus its queue — a boolean cannot interleave).
  const toggleAgent = (): void => {
    const current = useStore.getState().settings
    const next = { ...current, agentControl: !current.agentControl }
    setSettings(next)
    window.obsrv.setSettings(next).catch(() => setSettings(current))
  }

  // The bar follows the panes — a click in the native pane, a redirect, a
  // back — except while the user is typing in it: an `onUrlChanged` landing
  // mid-edit must not clobber the draft. Escape discards the edit. A mode
  // change overrides even a focused edit: the filename (or the restored URL)
  // is what the bar must show, and the edit was moot the moment it changed.
  const lastMode = useRef(mode)
  useEffect(() => {
    const modeChanged = lastMode.current !== mode
    lastMode.current = mode
    if (modeChanged || document.activeElement !== inputRef.current) setDraft(barText)
  }, [barText, mode])

  // View → Open Location (Cmd+L) arrives over IPC so it also works while the
  // native pane, an OS-level view outside this document, holds the focus.
  useEffect(() => {
    return window.obsrv.onFocusUrl(() => {
      inputRef.current?.focus()
      inputRef.current?.select()
    })
  }, [])

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

  // The shell paints the label itself, so it needs the chosen option's text.
  const presetLabel = SCREEN_PRESETS.find(p => p.id === presetId)?.label ?? 'Custom'
  const profileLabel = PANEL_PROFILES.find(p => p.id === profileId)?.label ?? profileId

  return (
    <div className="chrome">
      <div className="chrome-row chrome-browse">
        <button
          className="icon-button"
          type="button"
          title="Back"
          aria-label="Back"
          onClick={() => window.obsrv.back()}
        >
          <Icon name="back" />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Forward"
          aria-label="Forward"
          onClick={() => window.obsrv.forward()}
        >
          <Icon name="forward" />
        </button>
        <button
          className="icon-button"
          type="button"
          title="Reload"
          aria-label="Reload"
          onClick={() => window.obsrv.reload()}
        >
          <Icon name="reload" />
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

        {/* The only region that grows and shrinks, so appearing status
            reflows nothing but itself — the old toolbar shoved every
            control right when a load error arrived. */}
        <div className="status-cluster">
          {mode === 'image' && (
            <button
              className="icon-button close-image"
              type="button"
              title="Back to the live page"
              aria-label="Back to the live page"
              onClick={() => setMode('url')}
            >
              <Icon name="close" />
            </button>
          )}
          {loading && <span className="muted">loading…</span>}
          {error && (
            <span className="badge-error" title={error.description}>
              {error.code}
            </span>
          )}
          {viewport.clamped && (
            <span className="warn">
              clamped to {viewport.width}×{viewport.height}
            </span>
          )}
          {update?.status === 'available' && update.latest !== undefined && (
            <button
              className="update-button"
              type="button"
              title={`Obsrv ${update.latest} is available — opens the download page`}
              onClick={() => void window.obsrv.openRelease()}
            >
              v{update.latest} ↓
            </button>
          )}
        </div>

        <OverflowMenu>
          {close => (
            <>
              <label className="menu-row pixel-exact">
                <input
                  type="checkbox"
                  checked={pixelExact}
                  onChange={e => setPixelExact(e.target.checked)}
                />
                Pixel-exact
              </label>
              <button
                className="menu-row toggle-panel"
                type="button"
                role="menuitem"
                aria-pressed={drawer === 'panel'}
                onClick={() => {
                  onTogglePanel()
                  close()
                }}
              >
                <Icon name="sliders" />
                Panel controls
              </button>
              <button
                className="menu-row toggle-settings"
                type="button"
                role="menuitem"
                aria-pressed={drawer === 'settings'}
                onClick={() => {
                  onToggleSettings()
                  close()
                }}
              >
                <Icon name="gear" />
                Settings
              </button>
              <div className="menu-sep" />
              <label className="menu-row agent-toggle">
                <input type="checkbox" checked={agentControl} onChange={toggleAgent} />
                Agent control
              </label>
            </>
          )}
        </OverflowMenu>
      </div>

      <div className="chrome-row chrome-screen">
        <Select
          className="preset-select"
          value={presetId}
          label={presetLabel}
          ariaLabel="Target screen"
          onChange={setPreset}
        >
          <optgroup label="Laptops">
            {SCREEN_PRESETS.filter(p => p.group === 'laptop').map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Desktops">
            {SCREEN_PRESETS.filter(p => p.group === 'desktop').map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <optgroup label="Mobile">
            {SCREEN_PRESETS.filter(p => p.group === 'mobile').map(p => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </optgroup>
          <option value={CUSTOM_PRESET_ID}>Custom</option>
        </Select>

        <Segmented
          className="view-control"
          ariaLabel="Target view"
          value={viewMode}
          options={VIEWS.map(v => ({ ...v, className: v.id === 'fit' ? 'view-fit' : 'view-1x' }))}
          onChange={setViewMode}
        />

        <Segmented
          className="panes-control"
          ariaLabel="Panes"
          value={panes}
          options={PANES.map(p => ({ ...p, className: `panes-${p.id}` }))}
          onChange={setPanes}
        />

        <Select
          className="profile-select"
          value={profileId}
          label={profileLabel}
          ariaLabel="Panel profile"
          onChange={setProfile}
        >
          {PANEL_PROFILES.map(p => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>

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

        <div className="chrome-spacer" />

        {/* Agent control opens a loopback server, so it is never silently on:
            the chip persists while enabled and brightens for ~3s of activity. */}
        {agentControl && (
          <span className={`agent-activity${agentActive ? ' active' : ''}`}>AGENT</span>
        )}
      </div>
    </div>
  )
}
