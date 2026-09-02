import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FrameMessage } from '../../shared/api'
import { isBlankUrl } from '../../shared/url'
import { DropZone } from './components/DropZone'
import { Fatal } from './components/Fatal'
import { ImagePane } from './components/ImagePane'
import { NativeSlot } from './components/NativeSlot'
import { MIN_PANE_PX, PaneDivider } from './components/PaneDivider'
import { TargetFooter } from './components/PaneFooter'
import { PanelControls } from './components/PanelControls'
import { SettingsModal } from './components/SettingsModal'
import { EmptyState } from './components/EmptyState'
import { TargetCanvas } from './components/TargetCanvas'
import { Toast } from './components/Toast'
import { Toolbar, type Drawer } from './components/Toolbar'
import { probeMaxTextureSize } from './gl/renderer'
import { DEFAULT_IMAGE_LIMITS, loadImage, type LoadedImage } from './image/loadImage'
import { selectDeviceScaleFactor,
  selectIsMobileScreen, selectTab, selectViewport, useStore } from './state/store'

export function App() {
  const [fatal, setFatal] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<Drawer>('none')
  /**
   * Decoded files, one per tab. Keyed the same way every other piece of tab
   * state is, because image mode is per tab: a single slot here meant the tab
   * in front rendered whichever file was dropped last, in any tab — its own
   * name in the toolbar over another tab's pixels in both panes.
   */
  const [images, setImages] = useState<Record<string, LoadedImage>>({})
  // Latest drop wins: a slow decode must not land after a quicker later one.
  const dropToken = useRef(0)
  // The target pane's window-relative bounds (CSS px), reported to main so
  // the agent-control `captureTarget` can crop the window capture to the
  // pane. Null until the pane has mounted and been measured.
  const targetPaneRef = useRef<HTMLDivElement>(null)
  const [targetBounds, setTargetBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [canvasBounds, setCanvasBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  /** Whether main's tab list has arrived. See the `reportUiState` effect. */
  const [tabsKnown, setTabsKnown] = useState(false)
  const toggle = (which: 'panel' | 'settings') => () =>
    setDrawer(d => (d === which ? 'none' : which))

  const setHost = useStore(s => s.setHost)
  const setSettings = useStore(s => s.setSettings)
  const setTabUrl = useStore(s => s.setTabUrl)
  const setTabTitle = useStore(s => s.setTabTitle)
  const setTabError = useStore(s => s.setTabError)
  const setTabLoading = useStore(s => s.setTabLoading)
  const syncTabs = useStore(s => s.syncTabs)
  const setUpdate = useStore(s => s.setUpdate)
  const setHistory = useStore(s => s.setHistory)
  const setImageMeta = useStore(s => s.setImage)
  const setMode = useStore(s => s.setMode)
  const setToast = useStore(s => s.setToast)
  const mode = useStore(s => selectTab(s).mode)
  const surround = useStore(s => s.surround)
  const viewport = useStore(useShallow(selectViewport))
  const deviceScaleFactor = useStore(selectDeviceScaleFactor)
  const isMobileScreen = useStore(selectIsMobileScreen)
  const presetId = useStore(s => selectTab(s).presetId)
  const profileId = useStore(s => selectTab(s).profileId)
  const orientation = useStore(s => selectTab(s).orientation)
  const textScale = useStore(s => selectTab(s).textScale)
  const viewMode = useStore(s => selectTab(s).viewMode)
  const visionType = useStore(s => selectTab(s).visionType)
  const visionSeverity = useStore(s => selectTab(s).visionSeverity)
  const tabUrl = useStore(s => selectTab(s).url)
  const activeId = useStore(s => s.activeId)
  const tabOrder = useStore(s => s.tabOrder)
  const panes = useStore(s => s.panes)
  const nativeObscured = useStore(s => s.nativeObscured)
  const split = useStore(s => s.settings.split)

  // The store performs no IPC of its own; this is the one place that bridges.
  useEffect(() => {
    // A rejected query leaves the store's fallbacks in place (flat 2x scale,
    // default settings) rather than taking the app down before first paint.
    window.obsrv.getHostInfo().then(setHost, e => console.warn('obsrv: getHostInfo failed', e))
    window.obsrv.getSettings().then(setSettings, e => console.warn('obsrv: getSettings failed', e))
    // Re-read on every mount: a renderer reload would otherwise show nothing
    // until the next daily check.
    window.obsrv.getUpdate().then(setUpdate, e => console.warn('obsrv: getUpdate failed', e))
    // Same reason: a renderer reload would otherwise show an empty URL bar
    // dropdown until the next navigation pushed the list.
    window.obsrv.getHistory().then(setHistory, e => console.warn('obsrv: getHistory failed', e))
    // Main owns the tabs; this adopts the list it already holds, which after a
    // renderer reload is more than the one blank tab the store opens with.
    // `finally`, not `then`: a rejected query must still release the report
    // below, or a single failed invoke would leave main's agent mirror unseeded
    // and any queued agent patch stranded in main's pending list.
    window.obsrv
      .getTabs()
      .then(syncTabs, e => console.warn('obsrv: getTabs failed', e))
      .finally(() => setTabsKnown(true))
    const offs = [
      window.obsrv.onHostChanged(setHost),
      // Every one of these names its tab, so a background tab keeps its own
      // strip entry current without rewriting the address bar of the tab in
      // front — which is what an unnamed report from a background tab did, and
      // why main used to gate them on the tab being in front at all.
      //
      // A committed navigation — back, forward, reload, a link — supersedes
      // that tab's last load failure, and only a committed one: Chromium
      // commits its error page without emitting `did-navigate`, so a failed
      // load reports no URL at all (measured on Electron 43; a bad host, a
      // refused connection, a missing file and a Back onto an error page all
      // fire `did-fail-load` alone). The badge therefore lands last by having
      // nothing race it.
      window.obsrv.onUrlChanged(({ tabId, url }) => {
        setTabError(tabId, null)
        setTabUrl(tabId, url)
      }),
      window.obsrv.onTitleChanged(({ tabId, title }) => setTabTitle(tabId, title)),
      window.obsrv.onLoadError(({ tabId, error }) => setTabError(tabId, error)),
      window.obsrv.onTargetLoading(({ tabId, loading }) => setTabLoading(tabId, loading)),
      window.obsrv.onTabsChanged(syncTabs),
      window.obsrv.onUpdateStatus(setUpdate),
      window.obsrv.onHistoryChanged(setHistory),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [setHost, setSettings, setTabUrl, setTabTitle, setTabError, setTabLoading, syncTabs, setUpdate, setHistory])

  // `isMobileScreen` is a dependency, not just an argument: switching between
  // two screens of the same size and density but different kind — a custom
  // 1512x982 and the MacBook Pro preset, say — changes nothing else here, and
  // without it main would keep the previous browser identity.
  useEffect(() => {
    void window.obsrv.setViewport(viewport.width, viewport.height, deviceScaleFactor, isMobileScreen)
  }, [viewport.width, viewport.height, deviceScaleFactor, isMobileScreen])

  // The target keeps its own scale per tab, so a switch between two tabs at
  // the same scale sends nothing and one between different scales sends the
  // incoming tab's — which its target already has. Idempotent either way.
  useEffect(() => {
    void window.obsrv.setTextScale(textScale)
  }, [textScale])

  useEffect(() => {
    window.obsrv.setMode(mode)
  }, [mode])

  // The native pane is an OS-level overlay: unmounting its slot below leaves
  // the view on screen, so main is told explicitly. On the way back, React
  // runs NativeSlot's mount effect (which pushes bounds) before this parent
  // effect, so the view is positioned before it is revealed.
  useEffect(() => {
    window.obsrv.setNativeVisible(panes === 'both')
  }, [panes])

  // Same shape, different reason: the modal covers the panes and the chrome
  // cannot paint over an OS-composited layer. Main derives the visibility from
  // both inputs, so neither can clobber the other.
  useEffect(() => {
    window.obsrv.setNativeObscured(nativeObscured)
  }, [nativeObscured])


  // The pane's bounds change with the window, the drawers and the panes'
  // split, and every one of those also resizes the pane — so a
  // ResizeObserver is the one signal needed to keep the measurement fresh.
  useEffect(() => {
    const el = targetPaneRef.current
    if (!el) return

    // The rendered screen is the canvas, which at 1:1 usually overflows the
    // pane and when minified sits inside it — so the useful crop is the
    // intersection of the two, not the pane.
    const measure = (): void => {
      const pane = el.getBoundingClientRect()
      setTargetBounds({ x: pane.x, y: pane.y, width: pane.width, height: pane.height })

      const canvas = el.querySelector('canvas')
      if (!canvas) {
        setCanvasBounds(null)
        return
      }
      const c = canvas.getBoundingClientRect()
      const x = Math.max(pane.x, c.x)
      const y = Math.max(pane.y, c.y)
      const right = Math.min(pane.x + pane.width, c.x + c.width)
      const bottom = Math.min(pane.y + pane.height, c.y + c.height)
      setCanvasBounds(right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null)
    }

    const ro = new ResizeObserver(measure)
    ro.observe(el)
    const canvas = el.querySelector('canvas')
    if (canvas) ro.observe(canvas)
    // A ResizeObserver does not fire on scroll, but panning moves the canvas
    // under the pane, which changes the crop.
    el.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', measure)
    }
  }, [])

  // Main mirrors this for the agent-control server's `status`; the first run
  // seeds the mirror, later runs keep it in step with the toolbar.
  // `activeId` is a dependency as well as a field: a switch between two tabs
  // whose presets happen to match changes nothing else here, and main would
  // keep mirroring the tab that was left. It is also what lets main drop a
  // report that a switch overtook rather than write it onto the wrong tab.
  //
  // Held until the tab list has arrived. Until then the store holds one tab of
  // its own minting, described by defaults — and a report of those defaults
  // would land on whichever of main's sessions shares that id and overwrite
  // the screen main just restored from disk with a screen nobody chose. The
  // renderer has nothing worth saying about a list it has not yet been told.
  useEffect(() => {
    if (!tabsKnown) return
    window.obsrv.reportUiState({ tabId: activeId, presetId, profileId, orientation, textScale, viewMode, panes, mode, visionType, visionSeverity, targetBounds, canvasBounds })
  }, [tabsKnown, activeId, presetId, profileId, orientation, textScale, viewMode, panes, mode, visionType, visionSeverity, targetBounds, canvasBounds])

  // An agent-control command lands exactly as a toolbar interaction would:
  // the same store actions, so the viewport effect above (and everything else
  // hanging off the store) follows a remote preset flip like a local click.
  // panTo and highlight park in the store for TargetCanvas, which owns the
  // pane measurement and scale the two need.
  useEffect(() => {
    return window.obsrv.onAgentApply(patch => {
      const s = useStore.getState()
      if (patch.presetId !== undefined) s.setPreset(patch.presetId)
      if (patch.profileId !== undefined) s.setProfile(patch.profileId)
      if (patch.orientation !== undefined) s.setOrientation(patch.orientation)
      if (patch.textScale !== undefined) s.setTextScale(patch.textScale)
      if (patch.viewMode !== undefined) s.setViewMode(patch.viewMode)
      if (patch.panes !== undefined) s.setPanes(patch.panes)
      if (patch.pixelExact !== undefined) s.setPixelExact(patch.pixelExact)
      // Type and severity are one decision, so they are applied together: a
      // patch naming only the type takes the severity already in force.
      if (patch.visionType !== undefined) {
        s.setVision(patch.visionType, patch.visionSeverity ?? selectTab(useStore.getState()).visionSeverity)
      }
      if (patch.panTo !== undefined) s.requestAgentPan(patch.panTo)
      if (patch.highlight !== undefined) s.showAgentHighlight(patch.highlight)
    })
  }, [])

  // The surround control only repaints the field the panes sit in.
  useEffect(() => {
    document.documentElement.dataset.surround = surround
  }, [surround])

  /** This tab's decoded file, if it is holding one. */
  const image = images[activeId] ?? null
  // Nothing has been loaded yet: no address in URL mode, no file in image mode.
  const blank = mode === 'image' ? image === null : isBlankUrl(tabUrl)

  // The decoded pixels stay component state (they never need a selector); the
  // store carries only the metadata the toolbar and footer read. The pixels
  // land before `setMode('image')` so the readouts never see a mode without
  // a file.
  const onImage = async (file: File, exportScale: number): Promise<void> => {
    const token = ++dropToken.current
    // The tab the file was dropped on. A decode takes long enough for a tab
    // switch to happen underneath it, and the metadata and mode below are
    // written to whichever tab is in front.
    const tabId = activeId
    try {
      const limits = {
        ...DEFAULT_IMAGE_LIMITS,
        maxDimension: Math.min(DEFAULT_IMAGE_LIMITS.maxDimension, probeMaxTextureSize()),
      }
      const loaded = await loadImage(file, exportScale, limits)
      // Outlived by a later drop, or by a switch away from the tab it was
      // meant for: applying it now would describe one tab with another tab's
      // file. The bytes are dropped rather than filed somewhere hopeful.
      if (token !== dropToken.current || useStore.getState().activeId !== tabId) {
        URL.revokeObjectURL(loaded.objectUrl)
        return
      }
      setImages(previous => {
        const stale = previous[tabId]
        if (stale) URL.revokeObjectURL(stale.objectUrl)
        return { ...previous, [tabId]: loaded }
      })
      setImageMeta({
        name: file.name,
        exportScale,
        width: loaded.oneX.width,
        height: loaded.oneX.height,
      })
      setMode('image')
      // `boxDownsample` floors: a file that is not a whole number of 1x
      // pixels loses a partial row/column at the right and bottom edges.
      if (loaded.natural.width % exportScale || loaded.natural.height % exportScale) {
        setToast(`Edge pixels dropped: not a multiple of ${exportScale}x`)
      }
    } catch (e) {
      if (token !== dropToken.current) return
      setToast(e instanceof Error ? e.message : 'Could not read that file')
    }
  }

  // Leaving image mode (the ✕ button) drops that tab's decoded file and its
  // blob URL — that tab's, and no other. `mode` is the tab in front's, so a
  // switch to a URL tab runs this too: dropping every decoded file here
  // revoked the image of the tab being *left*, which then came back to an
  // empty pane over a canvas still frozen on someone else's frame.
  useEffect(() => {
    if (mode === 'image') return
    setImages(previous => {
      const going = previous[activeId]
      if (!going) return previous
      URL.revokeObjectURL(going.objectUrl)
      const next = { ...previous }
      delete next[activeId]
      return next
    })
  }, [mode, activeId])

  // A closed tab's file can never be shown again, and a blob URL that is never
  // revoked holds the decoded bytes for the life of the window.
  useEffect(() => {
    setImages(previous => {
      const open = new Set(tabOrder)
      const gone = Object.keys(previous).filter(id => !open.has(id))
      if (gone.length === 0) return previous
      const next = { ...previous }
      for (const id of gone) {
        URL.revokeObjectURL(next[id]!.objectUrl)
        delete next[id]
      }
      return next
    })
  }, [tabOrder])

  const imageFrame = useMemo<FrameMessage | null>(() => {
    if (mode !== 'image' || !image) return null
    return {
      frame: {
        x: 0,
        y: 0,
        width: image.oneX.width,
        height: image.oneX.height,
        data: image.bgra,
      },
      frameWidth: image.oneX.width,
      frameHeight: image.oneX.height,
    }
  }, [mode, image])

  if (fatal) return <Fatal message={fatal} />

  return (
    // The split and the panes mode are published here rather than on `.panes`
    // because the chrome needs them too: the URL bar's history dropdown is
    // clamped to the native pane's right edge, and a custom property set on
    // `.panes` reaches nothing above it. Everything below still inherits them.
    <div
      className="app"
      data-panes={panes}
      style={{ '--split': split, '--pane-min': `${MIN_PANE_PX}px` } as CSSProperties}
    >
      <Toolbar drawer={drawer} onTogglePanel={toggle('panel')} onToggleSettings={toggle('settings')} />
      <DropZone onImage={onImage} />
      <div className="body">
        {/* The split reaches the layout as a custom property rather than a
            width: the stylesheet owns how the ratio and the 240px floor
            combine, and the divider owns the drag. */}
        <div className="panes">
          {panes === 'both' && (
            <>
              {mode === 'image' && image ? (
                <ImagePane
                  src={image.objectUrl}
                  width={image.natural.width}
                  height={image.natural.height}
                />
              ) : (
                <NativeSlot />
              )}
              {/* A separator with one side would be a lie. It stays mounted on a
                  blank tab — removing it would change the split geometry, since
                  the seam is a flex item the panes are sized around — and the
                  empty state simply stacks above it. */}
              <PaneDivider />
            </>
          )}
          <div className="pane target-pane" ref={targetPaneRef}>
            <div className="pane-body">
              {/* The canvas stays mounted underneath: it owns the GL context and
                  the frame subscription, and tearing those down for an empty tab
                  would cost a context restore on every first navigation. */}
              <TargetCanvas onFatal={setFatal} imageFrame={imageFrame} />
            </div>
            <TargetFooter />
          </div>
          {/* Spans both panes rather than sitting in the target half. That is
              only possible because a blank tab has the native view hidden (see
              `nativeVisible` in main): the view is an OS-composited layer, and
              while it is up nothing the renderer paints can appear over it. */}
          {blank && <EmptyState />}
        </div>
        {drawer === 'panel' && (
          <aside className="drawer">
            <PanelControls />
          </aside>
        )}
      </div>
      {/* Not a drawer: a drawer narrows the panes so you can watch a render
          while you adjust it, which is what the panel sliders need and nothing
          in settings does. */}
      {drawer === 'settings' && <SettingsModal onClose={() => setDrawer('none')} />}
      <Toast />
    </div>
  )
}
