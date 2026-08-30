import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { matchHistory } from '../../../shared/history'
import { PANEL_PROFILES, SCREEN_PRESETS } from '../../../shared/presets'
import { formatAge } from '../../../shared/update'
import {
  CUSTOM_PRESET_ID,
  ORIENTATIONS,
  selectOrientationShapes,
  selectTab,
  selectUrlBarText,
  selectViewport,
  useStore,
  type Panes,
  type Surround,
  type ViewMode,
} from '../state/store'
import { useAgentActivity } from '../hooks/useAgentActivity'
import { Icon } from './Icon'
import { OverflowMenu } from './OverflowMenu'
import { Segmented } from './Segmented'
import { TabBar } from './TabBar'
import { Select, type SelectGroup, type SelectOption } from './Select'

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

/**
 * The screen menu, grouped as the presets themselves are. Built once: the list
 * never changes at runtime, and a fresh array each render would re-run the
 * menu's positioning effect.
 */
const inGroup = (group: string): SelectOption[] =>
  SCREEN_PRESETS.filter(p => p.group === group).map(p => ({ value: p.id, label: p.label }))

const PRESET_GROUPS: SelectGroup[] = [
  { label: 'Laptops', options: inGroup('laptop') },
  { label: 'Desktops', options: inGroup('desktop') },
  { label: 'Mobile', options: inGroup('mobile') },
  // Ungrouped, as it was: "Custom" is not one more screen among the presets.
  { options: [{ value: CUSTOM_PRESET_ID, label: 'Custom' }] },
]

const PROFILE_GROUPS: SelectGroup[] = [
  { options: PANEL_PROFILES.map(p => ({ value: p.id, label: p.label })) },
]

export function Toolbar({ drawer, onTogglePanel, onToggleSettings }: ToolbarProps) {
  const mode = useStore(s => selectTab(s).mode)
  const presetId = useStore(s => selectTab(s).presetId)
  const profileId = useStore(s => selectTab(s).profileId)
  const pixelExact = useStore(s => selectTab(s).pixelExact)
  const error = useStore(s => selectTab(s).error)
  const loading = useStore(s => selectTab(s).targetLoading)
  const barText = useStore(selectUrlBarText)
  const viewport = useStore(useShallow(selectViewport))

  const setUrl = useStore(s => s.setUrl)
  const setMode = useStore(s => s.setMode)
  const setPreset = useStore(s => s.setPreset)
  const orientation = useStore(s => selectTab(s).orientation)
  const orientationShapes = useStore(useShallow(selectOrientationShapes))
  const setOrientation = useStore(s => s.setOrientation)
  const setProfile = useStore(s => s.setProfile)
  const setPixelExact = useStore(s => s.setPixelExact)
  const setError = useStore(s => s.setError)
  const surround = useStore(s => s.surround)
  const update = useStore(s => s.update)
  const setSurround = useStore(s => s.setSurround)
  const viewMode = useStore(s => selectTab(s).viewMode)
  const setViewMode = useStore(s => s.setViewMode)
  const panes = useStore(s => s.panes)
  const setPanes = useStore(s => s.setPanes)
  const agentControl = useStore(s => s.settings.agentControl)
  const setSettings = useStore(s => s.setSettings)
  const history = useStore(s => s.history)

  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(barText)

  // The type-ahead list. `open` is what the user asked for (typed, or pressed
  // Down); `highlight` is -1 when nothing is picked, which is what makes Enter
  // navigate to the typed text rather than to a row.
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const matches = useMemo(() => (open ? matchHistory(history, draft) : []), [open, history, draft])
  const listOpen = open && matches.length > 0
  const closeList = (): void => {
    setOpen(false)
    setHighlight(-1)
  }
  // A row that scrolled out of the list, or vanished as the query narrowed,
  // must not stay selected — Enter would then navigate somewhere unseen.
  const picked = highlight >= 0 && highlight < matches.length ? matches[highlight]! : null

  // Lit while an authenticated agent-control command arrived in the last ~3 s,
  // so the user can see the visible app is being driven. Shared with the tab
  // strip's driven-tab marker, which lights on the same beat.
  const agentActive = useAgentActivity()

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

  // Image mode empties the list rather than leaving it hanging over a pane
  // the URL bar no longer describes.
  useEffect(() => {
    if (readOnly) closeList()
  }, [readOnly])

  const go = async (url: string): Promise<void> => {
    closeList()
    setError(null)
    const applied = await window.obsrv.navigate(url)
    setUrl(applied)
    // The input keeps focus through Enter, so the sync above would skip it.
    setDraft(applied)
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (readOnly || draft.trim() === '') return
    void go(draft)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (readOnly) return
    if (e.key === 'ArrowDown') {
      // Down opens the list and moves through it; the caret would otherwise
      // jump to the end of the field.
      e.preventDefault()
      if (!open) {
        setOpen(true)
        setHighlight(0)
        return
      }
      // Past the last row the highlight returns to the typed text, so a user
      // who overshoots can keep pressing Down instead of reaching for Up.
      setHighlight(h => (h + 1 >= matches.length ? -1 : h + 1))
      return
    }
    if (e.key === 'ArrowUp' && listOpen) {
      e.preventDefault()
      setHighlight(h => (h <= -1 ? matches.length - 1 : h - 1))
      return
    }
    if (e.key === 'Enter' && picked) {
      // The form's submit would navigate to the draft instead.
      e.preventDefault()
      void go(picked.url)
      return
    }
    if (e.key === 'Escape') {
      // The list first, the draft second. Escape has always reverted the
      // edit here, and closing a popover must not spend the press that does
      // it — one Escape to dismiss, another to undo.
      //
      // `listOpen`, not `open`: a query that matches nothing leaves the list
      // wanting to be open with nothing on screen, and an Escape that appears
      // to do nothing is worse than no dismissal at all. The state is cleared
      // either way, so the revert below cannot re-open the list against the
      // restored text.
      const dismissed = listOpen
      closeList()
      if (dismissed) return
      setDraft(barText)
    }
  }

  // The shell paints the label itself, so it needs the chosen option's text.
  const presetLabel = SCREEN_PRESETS.find(p => p.id === presetId)?.label ?? 'Custom'
  const profileLabel = PANEL_PROFILES.find(p => p.id === profileId)?.label ?? profileId

  return (
    <div className="chrome">
      {/* Inside `.chrome`, not beside it: main reserves `TOOLBAR_H` for this
          whole block before NativeSlot's first report, and a row outside it
          would put the native pane a row too high on every cold start. */}
      <TabBar />
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
            role="combobox"
            aria-expanded={listOpen}
            aria-controls="url-history"
            aria-autocomplete="list"
            aria-activedescendant={picked ? `url-history-${highlight}` : undefined}
            onChange={e => {
              setDraft(e.target.value)
              setOpen(true)
              // Typing re-queries, so whatever was picked is about to be a
              // different row; start from the typed text again.
              setHighlight(-1)
            }}
            onKeyDown={onKeyDown}
            onBlur={closeList}
          />
          {listOpen && (
            <ul className="url-history" id="url-history" role="listbox" aria-label="Visited addresses">
              {matches.map((m, i) => (
                <li
                  key={m.url}
                  id={`url-history-${i}`}
                  className={`url-history-row${i === highlight ? ' active' : ''}`}
                  role="option"
                  aria-selected={i === highlight}
                  // Not onClick: a click blurs the field first, which closes
                  // the list out from under the press. Suppressing the blur
                  // keeps the row alive long enough to act on.
                  onMouseDown={e => {
                    e.preventDefault()
                    void go(m.url)
                  }}
                  onMouseEnter={() => setHighlight(i)}
                >
                  <span className="url-history-url">
                    {/* `bdi` isolates the URL as one left-to-right run inside
                        the right-to-left box that moves the ellipsis; without
                        it a trailing `/` would be reordered to the front. */}
                    <bdi>{m.url}</bdi>
                  </span>
                  <span className="url-history-age">{formatAge(m.lastVisit, Date.now())}</span>
                </li>
              ))}
            </ul>
          )}
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
          groups={PRESET_GROUPS}
          onChange={setPreset}
        />

        {/* The `.surround-control` idiom rather than `Segmented`: the choice is
            a shape, and two outlines of the screen you get say it in 56px
            where two words would take 150. Pressed is the same `--chrome-3`
            fill step every other group in this row uses — never hue.

            Each button is named by the shape it *produces*, not by the flag it
            writes. For a phone the two agree; for a monitor preset, whose
            stored dimensions are landscape-natural, the rotated value yields a
            portrait screen — and a button reading "landscape" above a
            1080×1920 footer would be a lie the user has to unpick. */}
        <div className="orientation-control" role="group" aria-label="Screen orientation">
          {ORIENTATIONS.map((value, i) => {
            const shape = orientationShapes[i] ?? value
            const name = shape === 'landscape' ? 'Landscape' : 'Portrait'
            return (
              <button
                key={value}
                type="button"
                className={`orient-${shape}`}
                title={`${name} — ${value === orientation ? 'showing' : 'rotate the screen'}`}
                aria-label={name}
                aria-pressed={orientation === value}
                onClick={() => setOrientation(value)}
              >
                <Icon name={shape} />
              </button>
            )
          })}
        </div>

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
          groups={PROFILE_GROUPS}
          onChange={setProfile}
        />

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

        {/* No spacer: this row centres its controls, and the chip below is out
            of flow so its presence cannot shift them off centre. */}

        {/* Agent control opens a loopback server, so it is never silently on:
            the chip persists while enabled and brightens for ~3s of activity. */}
        {agentControl && (
          <span className={`agent-activity${agentActive ? ' active' : ''}`}>AGENT</span>
        )}
      </div>
    </div>
  )
}
