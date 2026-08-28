import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FrameMessage } from '../../shared/api'
import { DropZone } from './components/DropZone'
import { Fatal } from './components/Fatal'
import { ImagePane } from './components/ImagePane'
import { NativeSlot } from './components/NativeSlot'
import { MIN_PANE_PX, PaneDivider } from './components/PaneDivider'
import { TargetFooter } from './components/PaneFooter'
import { PanelControls } from './components/PanelControls'
import { SettingsPanel } from './components/SettingsPanel'
import { TargetCanvas } from './components/TargetCanvas'
import { Toast } from './components/Toast'
import { Toolbar, type Drawer } from './components/Toolbar'
import { probeMaxTextureSize } from './gl/renderer'
import { DEFAULT_IMAGE_LIMITS, loadImage, type LoadedImage } from './image/loadImage'
import { selectDeviceScaleFactor, selectTab, selectViewport, useStore } from './state/store'

export function App() {
  const [fatal, setFatal] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<Drawer>('none')
  const [image, setImage] = useState<LoadedImage | null>(null)
  // Latest drop wins: a slow decode must not land after a quicker later one.
  const dropToken = useRef(0)
  // The target pane's window-relative bounds (CSS px), reported to main so
  // the agent-control `captureTarget` can crop the window capture to the
  // pane. Null until the pane has mounted and been measured.
  const targetPaneRef = useRef<HTMLDivElement>(null)
  const [targetBounds, setTargetBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  const [canvasBounds, setCanvasBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
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
  const presetId = useStore(s => selectTab(s).presetId)
  const profileId = useStore(s => selectTab(s).profileId)
  const viewMode = useStore(s => selectTab(s).viewMode)
  const activeId = useStore(s => s.activeId)
  const panes = useStore(s => s.panes)
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
    window.obsrv.getTabs().then(syncTabs, e => console.warn('obsrv: getTabs failed', e))
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

  useEffect(() => {
    void window.obsrv.setViewport(viewport.width, viewport.height, deviceScaleFactor)
  }, [viewport.width, viewport.height, deviceScaleFactor])

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
  // (on mount) seeds the mirror, later runs keep it in step with the toolbar.
  // `activeId` is a dependency as well as a field: a switch between two tabs
  // whose presets happen to match changes nothing else here, and main would
  // keep mirroring the tab that was left. It is also what lets main drop a
  // report that a switch overtook rather than write it onto the wrong tab.
  useEffect(() => {
    window.obsrv.reportUiState({ tabId: activeId, presetId, profileId, viewMode, panes, mode, targetBounds, canvasBounds })
  }, [activeId, presetId, profileId, viewMode, panes, mode, targetBounds, canvasBounds])

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
      if (patch.viewMode !== undefined) s.setViewMode(patch.viewMode)
      if (patch.panes !== undefined) s.setPanes(patch.panes)
      if (patch.pixelExact !== undefined) s.setPixelExact(patch.pixelExact)
      if (patch.panTo !== undefined) s.requestAgentPan(patch.panTo)
      if (patch.highlight !== undefined) s.showAgentHighlight(patch.highlight)
    })
  }, [])

  // The surround control only repaints the field the panes sit in.
  useEffect(() => {
    document.documentElement.dataset.surround = surround
  }, [surround])

  // The decoded pixels stay component state (they never need a selector); the
  // store carries only the metadata the toolbar and footer read. `setImage`
  // lands before `setMode('image')` so the readouts never see a mode without
  // a file.
  const onImage = async (file: File, exportScale: number): Promise<void> => {
    const token = ++dropToken.current
    try {
      const limits = {
        ...DEFAULT_IMAGE_LIMITS,
        maxDimension: Math.min(DEFAULT_IMAGE_LIMITS.maxDimension, probeMaxTextureSize()),
      }
      const loaded = await loadImage(file, exportScale, limits)
      if (token !== dropToken.current) {
        URL.revokeObjectURL(loaded.objectUrl)
        return
      }
      setImage(previous => {
        if (previous) URL.revokeObjectURL(previous.objectUrl)
        return loaded
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

  // Leaving image mode (the ✕ button) drops the decoded file and its blob URL.
  useEffect(() => {
    if (mode === 'image') return
    setImage(previous => {
      if (previous) URL.revokeObjectURL(previous.objectUrl)
      return null
    })
  }, [mode])

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
              {/* A separator with one side would be a lie. */}
              <PaneDivider />
            </>
          )}
          <div className="pane target-pane" ref={targetPaneRef}>
            <div className="pane-body">
              <TargetCanvas onFatal={setFatal} imageFrame={imageFrame} />
            </div>
            <TargetFooter />
          </div>
        </div>
        {drawer === 'panel' && (
          <aside className="drawer">
            <PanelControls />
          </aside>
        )}
        {drawer === 'settings' && (
          <aside className="drawer">
            <SettingsPanel />
          </aside>
        )}
      </div>
      <Toast />
    </div>
  )
}
