import { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FrameMessage } from '../../shared/api'
import { DropZone } from './components/DropZone'
import { Fatal } from './components/Fatal'
import { ImagePane } from './components/ImagePane'
import { NativeSlot } from './components/NativeSlot'
import { TargetFooter } from './components/PaneFooter'
import { PanelControls } from './components/PanelControls'
import { SettingsPanel } from './components/SettingsPanel'
import { TargetCanvas } from './components/TargetCanvas'
import { Toast } from './components/Toast'
import { Toolbar, type Drawer } from './components/Toolbar'
import { probeMaxTextureSize } from './gl/renderer'
import { DEFAULT_IMAGE_LIMITS, loadImage, type LoadedImage } from './image/loadImage'
import { selectDeviceScaleFactor, selectViewport, useStore } from './state/store'

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
  const toggle = (which: 'panel' | 'settings') => () =>
    setDrawer(d => (d === which ? 'none' : which))

  const setHost = useStore(s => s.setHost)
  const setSettings = useStore(s => s.setSettings)
  const setUrl = useStore(s => s.setUrl)
  const setError = useStore(s => s.setError)
  const setTargetLoading = useStore(s => s.setTargetLoading)
  const setImageMeta = useStore(s => s.setImage)
  const setMode = useStore(s => s.setMode)
  const setToast = useStore(s => s.setToast)
  const mode = useStore(s => s.mode)
  const surround = useStore(s => s.surround)
  const viewport = useStore(useShallow(selectViewport))
  const deviceScaleFactor = useStore(selectDeviceScaleFactor)
  const presetId = useStore(s => s.presetId)
  const profileId = useStore(s => s.profileId)
  const viewMode = useStore(s => s.viewMode)

  // The store performs no IPC of its own; this is the one place that bridges.
  useEffect(() => {
    // A rejected query leaves the store's fallbacks in place (flat 2x scale,
    // default settings) rather than taking the app down before first paint.
    window.obsrv.getHostInfo().then(setHost, e => console.warn('obsrv: getHostInfo failed', e))
    window.obsrv.getSettings().then(setSettings, e => console.warn('obsrv: getSettings failed', e))
    const offs = [
      window.obsrv.onHostChanged(setHost),
      // A committed navigation — back, forward, reload, a link — supersedes
      // the last load failure. A *failed* load commits Chromium's error page
      // first and reports its error after, so the badge still lands last.
      window.obsrv.onUrlChanged(url => {
        setError(null)
        setUrl(url)
      }),
      window.obsrv.onLoadError(setError),
      window.obsrv.onTargetLoading(setTargetLoading),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [setHost, setSettings, setUrl, setError, setTargetLoading])

  useEffect(() => {
    void window.obsrv.setViewport(viewport.width, viewport.height, deviceScaleFactor)
  }, [viewport.width, viewport.height, deviceScaleFactor])

  useEffect(() => {
    window.obsrv.setMode(mode)
  }, [mode])

  // The pane's bounds change with the window, the drawers and the panes'
  // 50/50 split, and every one of those also resizes the pane — so a
  // ResizeObserver is the one signal needed to keep the measurement fresh.
  useEffect(() => {
    const el = targetPaneRef.current
    if (!el) return
    const measure = (): void => {
      const r = el.getBoundingClientRect()
      setTargetBounds({ x: r.x, y: r.y, width: r.width, height: r.height })
    }
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [])

  // Main mirrors this for the agent-control server's `status`; the first run
  // (on mount) seeds the mirror, later runs keep it in step with the toolbar.
  useEffect(() => {
    window.obsrv.reportUiState({ presetId, profileId, viewMode, mode, targetBounds })
  }, [presetId, profileId, viewMode, mode, targetBounds])

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
    <div className="app">
      <Toolbar drawer={drawer} onTogglePanel={toggle('panel')} onToggleSettings={toggle('settings')} />
      <DropZone onImage={onImage} />
      <div className="body">
        <div className="panes">
          {mode === 'image' && image ? (
            <ImagePane
              src={image.objectUrl}
              width={image.natural.width}
              height={image.natural.height}
            />
          ) : (
            <NativeSlot />
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
