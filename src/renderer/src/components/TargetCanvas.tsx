import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FrameMessage } from '../../../shared/api'
import { GlRenderer, MAX_OUTPUT_SIZE, fitScale } from '../gl/renderer'
import { REFERENCE_DSF } from '../../../shared/onionSkin'
import { visionMatrix } from '../../../shared/vision'
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio'
import { keyDownEvents, keyUpEvent, mouseEvent, toTargetPoint, wheelEvent } from '../input/inputBridge'
import {
  selectDeviceScaleFactor,
  selectPanelParams,
  selectPhysicalScale,
  selectScale,
  selectTab,
  selectViewport,
  useStore,
} from '../state/store'
import { centreScroll, computeFitScale, jumpScroll } from '../view/viewMath'

export interface TargetCanvasProps {
  onFatal: (message: string) => void
  /** In image mode the pixels come from a dropped file, not from the target. */
  imageFrame: FrameMessage | null
}

/** Spec §9: no paint for this long, when one was expected, is a stall. */
const STALL_MS = 2000

/**
 * How long a lost WebGL context is given to come back before the canvas is
 * replaced for a fresh one. Chromium's restore after a GPU reset lands well
 * inside this on a healthy machine; missing it costs only a wasted restore.
 */
const RESTORE_GRACE_MS = 1500
/**
 * Attempts at a fresh context, and the pause between them: the GPU process
 * is itself restarting, and the first ask can land before it is back.
 */
const RECOVERY_ATTEMPTS = 2
const RETRY_MS = 3000

/** The inspector asks the page at most this often while the pointer moves. */
const INSPECT_EVERY_MS = 80

export function TargetCanvas({ onFatal, imageFrame }: TargetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // The page's cursor, as CSS (see shared/cursor.ts). Worn only at rest: the
  // view gestures' classes (pan, fit, inspect) say what a press would do
  // here, and that outranks what the page would do there.
  const [pageCursor, setPageCursor] = useState('default')
  const glRef = useRef<GlRenderer | null>(null)

  const viewport = useStore(useShallow(selectViewport))
  const params = useStore(useShallow(selectPanelParams))
  // The viewer stage. Memoised on the two inputs, because a fresh matrix each
  // render would make `draw.current` a new object and defeat the ref above.
  const visionType = useStore(s => selectTab(s).visionType)
  const visionSeverity = useStore(s => selectTab(s).visionSeverity)
  const vision = useMemo(() => visionMatrix(visionType, visionSeverity), [visionType, visionSeverity])
  const dsf = useStore(selectDeviceScaleFactor)
  const requestedScale = useStore(selectScale)
  const physicalScale = useStore(selectPhysicalScale)
  const mode = useStore(s => selectTab(s).mode)
  const viewMode = useStore(s => selectTab(s).viewMode)
  const setViewMode = useStore(s => s.setViewMode)
  const setFitScale = useStore(s => s.setFitScale)
  const activeId = useStore(s => s.activeId)
  const inspecting = useStore(s => s.inspecting)
  const inspectPinned = useStore(s => s.inspectPinned)
  const inspection = useStore(s => s.inspection)
  const setInspection = useStore(s => s.setInspection)
  const setInspectPinned = useStore(s => s.setInspectPinned)
  const [stalled, setStalled] = useState(false)
  const stallTimer = useRef(0)
  const armedOnce = useRef(false)

  // Which canvas element this is. A lost WebGL context that Chromium will not
  // restore is written off with its element: bumping the epoch (the canvas's
  // React key) mounts a fresh one, and a fresh element is the only way to a
  // fresh context. `glGone` is the end of that road — no context to be had,
  // WebGL is off for the session and only a relaunch brings it back.
  const [epoch, setEpoch] = useState(0)
  const [glGone, setGlGone] = useState(false)
  // True from a context loss until a renderer is running again. The watchdog
  // is muted meanwhile: with no renderer there is nothing for a frame to land
  // on, and "no frames from target renderer" would be the one thing that is
  // not true.
  const lost = useRef(false)
  // Failed asks for a fresh context in the current episode.
  const attempts = useRef(0)
  // Main has paused the target's rasterisation: the window is hidden,
  // minimised or fully occluded. Told, not inferred — the shell's own page
  // visibility stays `visible` through all three.
  const paused = useRef(false)

  const disarm = useCallback((): void => {
    window.clearTimeout(stallTimer.current)
    setStalled(false)
  }, [])

  const arm = useCallback((): void => {
    // No renderer, or nobody looking: main pauses the target's rasterisation
    // while the window is hidden (see `TabManager.setShellVisible`), so a
    // navigation made then owes no frame until the window is back — and it
    // gets one the moment it is, because resuming invalidates the target.
    if (lost.current || paused.current) return
    window.clearTimeout(stallTimer.current)
    setStalled(false)
    stallTimer.current = window.setTimeout(() => setStalled(true), STALL_MS)
  }, [])

  // The GPU's backing-store limit, known once the renderer exists. Until then
  // the absolute cap stands in, which is never the binding one in practice.
  const [maxOutput, setMaxOutput] = useState(MAX_OUTPUT_SIZE)

  // Whichever source is live sizes the element: the dropped file's 1x pixels
  // in image mode, the target's *device* pixels otherwise — a mobile preset
  // paints CSS x dsf, and every downstream number (scale, CSS box, input
  // maths) is per device pixel.
  const source = imageFrame
    ? { width: imageFrame.frameWidth, height: imageFrame.frameHeight }
    : { width: viewport.width * dsf, height: viewport.height * dsf }

  // Re-read when the window moves between a 1x and a 2x display; the CSS
  // box and the input maths below both depend on it.
  const dpr = useDevicePixelRatio()

  // The pane's CSS box, observed so fit mode tracks a window resize or a
  // drawer opening. Measured on `.pane-body`, the scroll container.
  const [pane, setPane] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const body = canvasRef.current?.closest('.pane-body')
    if (!(body instanceof HTMLElement)) return
    const measure = (): void => setPane({ width: body.clientWidth, height: body.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(body)
    measure()
    return () => ro.disconnect()
  }, [])

  // The 1:1 magnification actually drawable. `GlRenderer.draw` applies the
  // same `fitScale`, so the CSS box and the input maths below agree with the
  // backing store even when a huge viewport × scale had to be reduced.
  const oneToOne = fitScale(source.width, source.height, requestedScale, maxOutput)

  // Fit mode scales the whole viewport into the pane — never enlarged past
  // true size — and minifies through the renderer's smooth sampler, because
  // nearest decimation at a small fraction moirés. The cap is the physical
  // 1:1, not `oneToOne`: that one follows the pixel-exact flag, which is the
  // 1:1 view's business and stays set underneath Fit, and a cap that moved
  // with it made Fit-from-Pixels a different picture from Fit-from-Actual.
  const fit = viewMode === 'fit'
  const trueSize = fitScale(source.width, source.height, physicalScale, maxOutput)
  const scale = fit
    ? computeFitScale(pane.width, pane.height, dpr, source.width, source.height, trueSize)
    : oneToOne
  // 1:1 on a mobile preset usually minifies too (a 460 PPI phone pixel gets
  // ~0.3 host pixels), and nearest decimation below 1 is as wrong there as in
  // fit mode — smooth whenever the drawn scale actually shrinks the source.
  const smooth = fit || scale < 1

  // The footer reads fit's actual magnification from the store; null outside
  // fit mode. Tracks the pane, the viewport and the 1:1 scale by deps — and
  // the active tab, because the readout describes whichever tab this canvas is
  // drawing. Two tabs on the same preset compute the same scale, so without
  // that dep the arriving tab keeps a null readout and the footer drops the
  // magnification it is actually showing.
  useEffect(() => {
    setFitScale(fit ? scale : null)
  }, [fit, scale, activeId, setFitScale])
  // The setter is stable, so this cleanup runs on unmount only: a torn-down
  // canvas must not leave a stale fit readout in the store.
  useEffect(() => () => setFitScale(null), [setFitScale])

  // Read by the frame callback, which is installed once and must not go
  // stale. `dsf` rides along for the input bridge: the canvas shows device
  // pixels, `sendInputEvent` wants CSS ones.
  // The onion skin's second pass: the reference frame is `REFERENCE_DSF`
  // device px per CSS px where the target's is `dsf`, so the same CSS box
  // draws at that ratio of the target's magnification.
  const onionSkin = useStore(s => selectTab(s).onionSkin)
  const onion = { opacity: onionSkin, scale: (scale * dsf) / REFERENCE_DSF }
  const draw = useRef({ scale, params, smooth, dsf, vision, onion })
  // Read by `start` after a context restore, so the image is re-uploaded
  // without waiting for a frame that image mode will never send.
  const imageRef = useRef(imageFrame)

  // The live pan gesture (middle drag or Option+left drag), read by the
  // once-installed listeners below as well as the React handlers.
  const panRef = useRef<{
    pointerId: number
    x: number
    y: number
    left: number
    top: number
  } | null>(null)
  const [panning, setPanning] = useState(false)
  const [altHeld, setAltHeld] = useState(false)
  // True between a forwarded mouseDown and its forwarded mouseUp. Option only
  // suppresses *new* gestures: a drag the page already owns must complete —
  // its moves and its release still forward even if Option goes down
  // mid-drag, or the page would be left dragging forever.
  const forwardDrag = useRef(false)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    let gl: GlRenderer | null = null
    let offFrame: (() => void) | null = null
    let offReference: (() => void) | null = null
    let raf = 0
    // The pending recovery step after a context loss, if any.
    let recovery = 0

    // Slices are uploaded as they arrive; the draw is batched to one per
    // animation frame, however many dirty rects a paint was split into.
    const paint = (): void => {
      raf = 0
      if (gl && gl.sourceWidth > 0) gl.draw(draw.current)
    }
    const schedule = (): void => {
      if (raf === 0) raf = requestAnimationFrame(paint)
    }

    // Subscribing is what opens frame delivery (the preload's first `onFrame`
    // sends `frameSubscribe` and main answers with a full frame), so a fresh
    // subscription after a context loss refills the texture by itself.
    const start = (): boolean => {
      try {
        gl = new GlRenderer(canvas)
      } catch (e) {
        // On the first canvas this is a machine without WebGL2, and there is
        // nothing to show. On a replacement it is a context Chromium will not
        // grant: once more after a pause, in case the GPU process is still
        // coming back, and then it is gone for the session.
        canvas.dataset.gl = 'none'
        if (epoch === 0) {
          onFatal(e instanceof Error ? e.message : 'WebGL2 is not available')
        } else if (++attempts.current < RECOVERY_ATTEMPTS) {
          window.obsrv.log(`no webgl context on the replacement canvas (attempt ${attempts.current}); retrying`)
          recovery = window.setTimeout(() => setEpoch(n => n + 1), RETRY_MS)
        } else {
          window.obsrv.log('no webgl context on the replacement canvas; webgl is gone for the session, restart offered')
          setGlGone(true)
        }
        return false
      }
      // The context's state, for the e2e suite: asking `getContext` from a
      // test would create one on a canvas that has none, and report a health
      // the app never had.
      canvas.dataset.gl = 'ok'
      attempts.current = 0
      lost.current = false
      glRef.current = gl
      setMaxOutput(gl.maxOutputSize)
      const image = imageRef.current
      if (image) {
        gl.resizeSource(image.frameWidth, image.frameHeight)
        gl.uploadSlice(image.frame)
        schedule()
      }
      offFrame = window.obsrv.onFrame(m => {
        disarm()
        if (!gl) return
        // Main stops frames on `setMode('image')`, but one already in flight
        // must not land on top of the dropped file's pixels.
        if (selectTab(useStore.getState()).mode !== 'url') return
        // Trust the message's dims: frames painted against the previous
        // viewport are still in flight for a moment after a resize.
        gl.resizeSource(m.frameWidth, m.frameHeight)
        gl.uploadSlice(m.frame)
        schedule()
      })
      // The reference render's frames, when a skin is on: the same shape,
      // into the second texture. Subscribing opens delivery as above.
      offReference = window.obsrv.onReferenceFrame(m => {
        if (!gl) return
        if (selectTab(useStore.getState()).mode !== 'url') return
        gl.resizeReference(m.frameWidth, m.frameHeight)
        gl.uploadReferenceSlice(m.frame)
        schedule()
      })
      return true
    }
    const stop = (): void => {
      offFrame?.()
      offFrame = null
      offReference?.()
      offReference = null
      if (raf !== 0) cancelAnimationFrame(raf)
      raf = 0
      gl?.dispose()
      gl = null
      glRef.current = null
    }

    // Context loss — in practice the GPU process dying under the app.
    // `preventDefault` keeps the context restorable. The subscription goes
    // with the renderer, since frames have nowhere to land, so the watchdog
    // is disarmed with it: left armed it would report "no frames" over a
    // target that is painting for nobody, and its Reload button reloads the
    // wrong thing. Chromium restores after a single reset and the renderer is
    // rebuilt on the same canvas. When the restore does not come inside the
    // grace period, the canvas is replaced (see `epoch`). A frame is owed
    // either way — a new subscription is answered with a full frame — so the
    // watchdog is re-armed to watch for it.
    const onLost = (e: Event): void => {
      e.preventDefault()
      stop()
      canvas.dataset.gl = 'lost'
      lost.current = true
      disarm()
      window.obsrv.log('webgl context lost')
      window.clearTimeout(recovery)
      recovery = window.setTimeout(() => {
        window.obsrv.log('webgl context not restored in time; replacing the canvas')
        setEpoch(n => n + 1)
      }, RESTORE_GRACE_MS)
    }
    const onRestored = (): void => {
      window.clearTimeout(recovery)
      const ok = start()
      window.obsrv.log(ok ? 'webgl context restored' : 'webgl context restored, but no renderer could be built on it')
      if (ok && selectTab(useStore.getState()).mode === 'url') arm()
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)

    // React's onWheel is passive, so the page would scroll under the canvas.
    // The wheel is claimed for the target only in URL mode; in image mode
    // there is nothing to scroll in the target and the pane scrolls natively.
    // The bridge maps CSS pixels, so it divides by the CSS magnification
    // (S / DPR), not by S.
    const onWheel = (e: WheelEvent): void => {
      // Alt+wheel is the pan chord and never reaches the page: it scrolls
      // the pane in natural direction in 1:1, and is a no-op in fit — fit
      // has nothing to pan, and forwarding an Alt-modified wheel would be a
      // different gesture to the page than the one the user made.
      if (e.altKey) {
        e.preventDefault()
        if (selectTab(useStore.getState()).viewMode !== '1:1') return
        const body = canvas.closest('.pane-body')
        if (body instanceof HTMLElement) {
          body.scrollLeft += e.deltaX
          body.scrollTop += e.deltaY
        }
        return
      }
      // A plain wheel forwards in fit mode too, so the page can be browsed
      // from the overview.
      if (selectTab(useStore.getState()).mode !== 'url') return
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      const cssPerTarget = (draw.current.scale * draw.current.dsf) / (window.devicePixelRatio || 1)
      const ev = wheelEvent(e, r, cssPerTarget)
      if (ev) window.obsrv.sendInput(ev)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })

    // A drag that ends off the canvas must still release the button in the
    // target, or it keeps dragging until the next click. Leaving the canvas
    // mid-drag is deliberately *not* a release: the pointer can come back
    // (a scrollbar drag, a selection that overshoots the edge), and the
    // target's own button state is what decides when the drag ends.
    const onWindowUp = (e: MouseEvent): void => {
      if (selectTab(useStore.getState()).mode !== 'url') return
      // Same forwarding rules as `send`: both views forward, the pan chords
      // never do, and Option only suppresses a release that is not completing
      // a forwarded drag.
      if (panRef.current || e.button === 1) return
      if (e.altKey && !forwardDrag.current) return
      if (e.target === canvas) return // the canvas's own onMouseUp sent it
      const r = canvas.getBoundingClientRect()
      const cssPerTarget = (draw.current.scale * draw.current.dsf) / (window.devicePixelRatio || 1)
      const ev = mouseEvent('mouseUp', e, r, cssPerTarget)
      if (ev) {
        window.obsrv.sendInput(ev)
        forwardDrag.current = false
      }
    }
    window.addEventListener('mouseup', onWindowUp)

    const started = start()
    // A replacement canvas is a fresh subscription, so a frame is on its way.
    if (started && epoch > 0) {
      window.obsrv.log(`webgl context recovered on a replacement canvas (${epoch})`)
      if (selectTab(useStore.getState()).mode === 'url') arm()
    }

    return () => {
      window.clearTimeout(recovery)
      if (started) stop()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('mouseup', onWindowUp)
    }
  }, [onFatal, disarm, arm, epoch])

  // Arm on a main-frame, cross-document navigation only — not on
  // `targetLoading`, which also rises for a subframe load: an iframe on a
  // healthy static page changes no pixel and owes no frame, so a watchdog
  // keyed to loading would cry wolf on it. (`targetLoading` still drives the
  // URL field's loading strip.) Image mode never arms: main stops target frames on
  // `setMode('image')` by design, so "no frame" is the normal state there,
  // and a Cmd+R that reloads the hidden panes is tolerated for the same
  // reason.
  useEffect(
    () =>
      window.obsrv.onTargetNavigating(({ tabId }) => {
        // Every tab's target reports now, not just the one in front. The
        // canvas draws one tab, so a background tab's navigation owes *it*
        // nothing — arming on it would raise a stall notice over a tab that
        // is painting perfectly well.
        const s = useStore.getState()
        if (tabId !== s.activeId) return
        if (selectTab(s).mode === 'url') arm()
      }),
    [arm],
  )

  useEffect(() => {
    if (mode !== 'url') disarm()
  }, [mode, disarm])

  // `arm` refuses while paused; this drops a watch that was already running
  // when the window went away, since the frame it waits for is not coming.
  useEffect(
    () =>
      window.obsrv.onTargetPaused(isPaused => {
        paused.current = isPaused
        if (isPaused) disarm()
      }),
    [disarm],
  )

  // Every tab's target reports its cursor; the canvas draws one tab. Main
  // re-sends the incoming tab's on a switch, so nothing is reset here — a
  // reset would race that message and win.
  useEffect(
    () =>
      window.obsrv.onTargetCursor(({ tabId, cursor }) => {
        if (tabId === useStore.getState().activeId) setPageCursor(cursor)
      }),
    [],
  )

  // A <select> on the page cannot open offscreen; its rows arrive here and
  // are drawn by the overlay menu the toolbar uses, anchored over the
  // element's box on the canvas (surface CSS px, the inspect highlight's
  // space). The choice goes back to main, which writes it into the page.
  // Subscribed against the current geometry: the anchor needs the scale in
  // force when the popup arrives, not when the canvas mounted.
  useEffect(
    () =>
      window.obsrv.onSelectPopup(async popup => {
        const canvas = canvasRef.current
        if (popup.tabId !== useStore.getState().activeId || !canvas) {
          window.obsrv.pickSelect({ tabId: popup.tabId, id: popup.id, index: null })
          return
        }
        const box = canvas.getBoundingClientRect()
        const k = (dsf * scale) / dpr
        const picked = await window.obsrv.openMenu({
          groups: popup.groups,
          value: String(popup.selectedIndex),
          ariaLabel: popup.ariaLabel,
          anchor: {
            x: box.left + popup.rect.x * k,
            y: box.top + popup.rect.y * k,
            width: popup.rect.width * k,
            height: popup.rect.height * k,
          },
        })
        window.obsrv.pickSelect({ tabId: popup.tabId, id: popup.id, index: picked === null ? null : Number(picked) })
        // The select keeps focus in the page; the canvas takes it back here
        // so the next keystroke reaches it, as after any forwarded click.
        canvas.focus()
      }),
    [dsf, scale, dpr],
  )

  // A date, time or colour input on the page asked for its picker, which
  // Chromium cannot open offscreen: the overlay hosts an input of the same
  // type over the element's box on the canvas (see shared/pickerPopup.ts)
  // and main streams its values into the page. Anchored like the select.
  useEffect(
    () =>
      window.obsrv.onPickerPopup(async popup => {
        const canvas = canvasRef.current
        if (popup.tabId !== useStore.getState().activeId || !canvas) return
        const box = canvas.getBoundingClientRect()
        const k = (dsf * scale) / dpr
        const { rect, ...rest } = popup
        await window.obsrv.openPicker({
          ...rest,
          anchor: {
            x: box.left + rect.x * k,
            y: box.top + rect.y * k,
            width: rect.width * k,
            height: rect.height * k,
          },
        })
        canvas.focus()
      }),
    [dsf, scale, dpr],
  )

  // A viewport change invalidates the target, so a frame is owed. Not on
  // mount, though: the shell's own boot sequence (viewport push, frame
  // handshake) can take longer than STALL_MS on a cold start, and the notice
  // would flash before the first frame of a perfectly healthy target.
  useEffect(() => {
    if (!armedOnce.current) {
      armedOnce.current = true
      return
    }
    if (mode === 'url') arm()
  }, [viewport.width, viewport.height, dsf, mode, arm])

  useEffect(() => () => window.clearTimeout(stallTimer.current), [])

  // Scale, panel params, the view mode and the viewer simulation can all change
  // without a new frame — a static page sends none, so without the redraw here
  // the setting would appear to do nothing until something else moved.
  useEffect(() => {
    draw.current = { scale, params, smooth, dsf, vision, onion: { opacity: onionSkin, scale: (scale * dsf) / REFERENCE_DSF } }
    const gl = glRef.current
    // A skin turned off drops the reference texture too, so that the next
    // skin starts from the full frame main sends and not from a ghost of
    // whatever page the last one showed.
    if (gl && onionSkin === 0) gl.clearReference()
    if (gl && gl.sourceWidth > 0) gl.draw(draw.current)
  }, [scale, params, smooth, dsf, vision, onionSkin])

  // Live frames are already stopped by main's `setMode`, so there is no race.
  // On the way back to URL mode the next live frame (main resends a full one)
  // resizes the source again; nothing to undo here.
  useEffect(() => {
    imageRef.current = imageFrame
    const gl = glRef.current
    if (!gl || !imageFrame) return
    gl.resizeSource(imageFrame.frameWidth, imageFrame.frameHeight)
    gl.uploadSlice(imageFrame.frame)
    gl.draw(draw.current)
  }, [imageFrame])

  // Option held over the canvas advertises the pan chord (`grab` cursor)
  // and suppresses forwarding; released — or the window blurred with the key
  // still down — forwarding resumes.
  useEffect(() => {
    const down = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAltHeld(true)
    }
    const up = (e: KeyboardEvent): void => {
      if (e.key === 'Alt') setAltHeld(false)
    }
    const clear = (): void => setAltHeld(false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', clear)
    }
  }, [])

  // A pan drags the pane's scroll position, so the gesture needs the scroll
  // container; the pointer is captured so a drag survives leaving the pane.
  const paneBody = (): HTMLElement | null => {
    const body = canvasRef.current?.closest('.pane-body')
    return body instanceof HTMLElement ? body : null
  }

  const startPan = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    // Never in fit: the render fits by construction, so there is nothing to
    // pan — and a pan started on an Option+left press would set `panRef` and
    // swallow the Option+click jump below.
    if (fit) return
    if (!(e.button === 1 || (e.button === 0 && e.altKey))) return
    const body = paneBody()
    if (!body) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    panRef.current = {
      pointerId: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      left: body.scrollLeft,
      top: body.scrollTop,
    }
    setPanning(true)
  }
  const movePan = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const pan = panRef.current
    if (!pan || e.pointerId !== pan.pointerId) return
    const body = paneBody()
    if (!body) return
    // The content follows the pointer; the browser clamps the positions.
    body.scrollLeft = pan.left - (e.clientX - pan.x)
    body.scrollTop = pan.top - (e.clientY - pan.y)
  }
  const endPan = (e: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean): void => {
    const pan = panRef.current
    if (!pan || e.pointerId !== pan.pointerId) return
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    setPanning(false)
    if (cancelled) {
      panRef.current = null
      return
    }
    // The compatibility mouseup for this same release is dispatched after
    // this handler, in the same task, and must not forward as a phantom
    // release; the ref clears once that task has drained.
    window.setTimeout(() => {
      if (panRef.current === pan) panRef.current = null
    }, 0)
  }

  // An Option+click in fit mode is the way back: 1:1 with the clicked target
  // pixel centred. The scroll applies in a layout effect, after React has
  // committed the 1:1 canvas box — before that, the fit-sized content would
  // clamp both offsets to 0.
  const pendingJump = useRef<{ left: number; top: number } | null>(null)
  useLayoutEffect(() => {
    if (viewMode !== '1:1' || !pendingJump.current) return
    const body = paneBody()
    if (body) {
      body.scrollLeft = pendingJump.current.left
      body.scrollTop = pendingJump.current.top
    }
    pendingJump.current = null
  }, [viewMode])

  const jumpTo1x = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    // Option+click, never a plain one. Fit forwards input to the page now, so
    // a plain click is the page's; one press cannot both act on the page and
    // change the view. Option is already this pane's view-manipulation
    // modifier (Option+drag and Option+wheel pan at 1:1) and `send` below
    // drops Option-modified events, so the two gestures cannot collide.
    if (!fit || !e.altKey) return
    const r = e.currentTarget.getBoundingClientRect()
    pendingJump.current = jumpScroll(
      e.clientX - r.left,
      e.clientY - r.top,
      dpr,
      scale,
      oneToOne,
      pane.width,
      pane.height,
      source.width,
      source.height,
    )
    setViewMode('1:1')
  }

  // An agent-control `panTo` centres a target pixel exactly as a fit click
  // would: from fit mode the same pending-jump path switches to 1:1 centred
  // there; already at 1:1 the pane scrolls directly. Applied here — not in
  // App — because the centring needs the pane measurement and 1:1 scale this
  // component owns.
  const agentPan = useStore(s => selectTab(s).agentPan)
  const clearAgentPan = useStore(s => s.clearAgentPan)
  useEffect(() => {
    if (!agentPan) return
    clearAgentPan()
    const jump = centreScroll(agentPan.x, agentPan.y, dpr, oneToOne, pane.width, pane.height, source.width, source.height)
    if (viewMode === 'fit') {
      pendingJump.current = jump
      setViewMode('1:1')
      return
    }
    const body = paneBody()
    if (body) {
      body.scrollLeft = jump.left
      body.scrollTop = jump.top
    }
    // The other values are read, not reacted to: the effect fires on a new
    // request and applies it with whatever geometry is current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentPan])

  // The agent-control highlight's lifetime; a replacement highlight (fresh
  // seq) cancels this timer through the effect cleanup and starts its own.
  // The seq rides into the clear as a guard: a timeout that has already been
  // queued when a replacement lands (or when a navigation clears the store)
  // must remove only the highlight it was armed for, never a newer one.
  const agentHighlight = useStore(s => selectTab(s).agentHighlight)
  const clearAgentHighlight = useStore(s => s.clearAgentHighlight)
  useEffect(() => {
    if (!agentHighlight) return
    const t = window.setTimeout(() => clearAgentHighlight(agentHighlight.seq), agentHighlight.durationMs)
    return () => window.clearTimeout(t)
  }, [agentHighlight, clearAgentHighlight])

  // Every bridge builder may return null (unnamed button, pinch gesture,
  // dead key); those events are dropped, never sent as something else.
  const send =
    (type: 'mouseDown' | 'mouseUp' | 'mouseMove') =>
    (e: ReactMouseEvent<HTMLCanvasElement>): void => {
      if (mode !== 'url') return
      // The inspector reads the page instead of driving it.
      if (inspecting) return
      // Both views forward: fit is interactive, at its own magnification,
      // which the `scale` below already carries. The pan chords still own the
      // pointer — nothing forwards while a pan is live, or for the middle
      // button (the pan gesture's own press and release included). Option
      // suppresses new gestures and idle hovers only — see `forwardDrag`.
      if (panRef.current || e.button === 1) return
      if (e.altKey && !forwardDrag.current) return
      // The canvas shows device pixels at `scale` host px each; the target
      // page takes CSS coordinates, `dsf` device pixels big.
      const out = mouseEvent(type, e, e.currentTarget.getBoundingClientRect(), (scale * dsf) / dpr)
      if (out) {
        window.obsrv.sendInput(out)
        if (type === 'mouseDown') forwardDrag.current = true
        else if (type === 'mouseUp') forwardDrag.current = false
      }
    }

  // The inspector's hover. The page is asked what is under the pointer at
  // most every INSPECT_EVERY_MS, with a trailing ask so the readout ends on
  // where the pointer stopped, and answers that arrive out of order are
  // dropped: a slow answer about where the pointer *was* must not land on
  // top of a fresh one about where it is.
  const inspectSeq = useRef(0)
  const inspectLast = useRef(0)
  const inspectTimer = useRef(0)
  const inspectPoint = useRef<{ x: number; y: number } | null>(null)
  const flushInspect = (): void => {
    const p = inspectPoint.current
    if (!p) return
    inspectPoint.current = null
    inspectLast.current = performance.now()
    const seq = ++inspectSeq.current
    void window.obsrv.inspect(p).then(report => {
      if (seq === inspectSeq.current) setInspection(report)
    })
  }
  const inspectAt = (e: ReactMouseEvent<HTMLCanvasElement>): void => {
    // The canvas shows device pixels at `scale` host px each; the page
    // answers in CSS pixels, `dsf` device pixels big — the same mapping the
    // forwarded input uses.
    inspectPoint.current = toTargetPoint(e, e.currentTarget.getBoundingClientRect(), (scale * dsf) / dpr)
    const due = INSPECT_EVERY_MS - (performance.now() - inspectLast.current)
    if (due <= 0) flushInspect()
    else if (inspectTimer.current === 0) {
      inspectTimer.current = window.setTimeout(() => {
        inspectTimer.current = 0
        flushInspect()
      }, due)
    }
  }
  useEffect(() => () => window.clearTimeout(inspectTimer.current), [])

  // Backing store is `round(viewport × S)` device pixels (the rounding is
  // `GlRenderer.draw`'s); the CSS box divides that back out so the browser
  // maps it 1:1 instead of resampling. For the moment after a viewport change
  // when frames of the old size are still arriving, the backing store lags
  // this box — those frames are stale by definition.
  const cssW = Math.round(source.width * scale) / dpr
  const cssH = Math.round(source.height * scale) / dpr

  // The notice sits inside the target pane's own scroll box — never over the
  // left pane, which the native view owns. It is a sibling *before* the
  // canvas-width wrap, not inside it: as a direct block child of the
  // `.pane-body` scroll container it is the pane's width, so its sticky
  // `left: 0` holds while a wide canvas is scrolled horizontally.
  return (
    <>
      {glGone ? (
        // Not a stall: the target is painting, this renderer cannot draw it,
        // and nothing in this process can change that.
        <div className="stall gl-gone" role="alert">
          <span>Graphics reset: WebGL is unavailable until Obsrv restarts</span>
          <button type="button" onClick={() => window.obsrv.relaunch()}>
            Restart Obsrv
          </button>
        </div>
      ) : (
        stalled && (
          <div className="stall" role="alert">
            <span>No frames from target renderer</span>
            <button
              type="button"
              onClick={() => {
                arm()
                window.obsrv.reload()
              }}
            >
              Reload
            </button>
          </div>
        )
      )}
      <div className="target-wrap">
        <canvas
          key={epoch}
          ref={canvasRef}
          // Resting state carries no class in either view: the pane is
          // interactive, so the page's own cursors show through. Option is
          // what reveals a view gesture — the jump in fit, the pan at 1:1.
          className={`target-canvas${
            inspecting ? ' inspecting' : panning ? ' panning' : altHeld ? (fit ? ' fit' : ' pan-ready') : ''
          }`}
          tabIndex={0}
          style={{
            width: `${cssW}px`,
            height: `${cssH}px`,
            // The page's cursor at rest; a view gesture's class outranks it.
            ...(inspecting || panning || altHeld ? {} : { cursor: pageCursor }),
          }}
          // In inspect mode a click pins the readout so the pointer can
          // leave; the fit-to-1:1 jump is the click's meaning otherwise.
          onClick={e => {
            if (inspecting) setInspectPinned(!inspectPinned)
            else jumpTo1x(e)
          }}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={e => endPan(e, false)}
          onPointerCancel={e => endPan(e, true)}
          onMouseDown={send('mouseDown')}
          onMouseUp={send('mouseUp')}
          onMouseMove={e => {
            if (!inspecting) send('mouseMove')(e)
            else if (!inspectPinned) inspectAt(e)
          }}
          onMouseLeave={() => {
            if (inspecting && !inspectPinned) setInspection(null)
          }}
          // No onMouseLeave release: the window mouseup listener above catches
          // a release that lands outside the canvas, and a drag that crosses
          // the edge and comes back stays a drag.
          onKeyDown={e => {
            // Keys forward from either view: a field focused by a forwarded
            // click in fit must be typeable, or fit would be half a session.
            if (mode !== 'url') return
            // Leave shortcuts to the OS and the app menu.
            if (!e.metaKey && !e.ctrlKey) e.preventDefault()
            for (const ev of keyDownEvents(e)) window.obsrv.sendInput(ev)
          }}
          onKeyUp={e => {
            if (mode !== 'url') return
            const ev = keyUpEvent(e)
            if (ev) window.obsrv.sendInput(ev)
          }}
        />
        {agentHighlight && (
          // The agent-control highlight: a target-pixel rect drawn at the
          // canvas's own scale, absolutely positioned inside the scroll
          // content so it rides the pane's scroll. Neutral by style-spec law
          // (no hue) and pointer-events: none, so it never intercepts the
          // input the canvas forwards.
          <div
            className="agent-highlight"
            style={{
              left: `${(agentHighlight.x * scale) / dpr}px`,
              top: `${(agentHighlight.y * scale) / dpr}px`,
              width: `${(agentHighlight.width * scale) / dpr}px`,
              height: `${(agentHighlight.height * scale) / dpr}px`,
            }}
          />
        )}
        {inspecting && inspection && (
          // The inspector's highlight: the agent highlight's twin, for the
          // element under the pointer. The page answers in CSS pixels, so
          // its rect scales by `dsf` on the way to canvas coordinates.
          <div
            className="inspect-highlight"
            style={{
              left: `${(inspection.rect.x * dsf * scale) / dpr}px`,
              top: `${(inspection.rect.y * dsf * scale) / dpr}px`,
              width: `${(inspection.rect.width * dsf * scale) / dpr}px`,
              height: `${(inspection.rect.height * dsf * scale) / dpr}px`,
            }}
          />
        )}
      </div>
    </>
  )
}
