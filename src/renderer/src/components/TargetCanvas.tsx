import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { FrameMessage } from '../../../shared/api'
import { GlRenderer, MAX_OUTPUT_SIZE, fitScale } from '../gl/renderer'
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio'
import { keyDownEvents, keyUpEvent, mouseEvent, wheelEvent } from '../input/inputBridge'
import { selectPanelParams, selectScale, selectViewport, useStore } from '../state/store'
import { computeFitScale, jumpScroll } from '../view/viewMath'

export interface TargetCanvasProps {
  onFatal: (message: string) => void
  /** In image mode the pixels come from a dropped file, not from the target. */
  imageFrame: FrameMessage | null
}

/** Spec §9: no paint for this long, when one was expected, is a stall. */
const STALL_MS = 2000

export function TargetCanvas({ onFatal, imageFrame }: TargetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<GlRenderer | null>(null)

  const viewport = useStore(useShallow(selectViewport))
  const params = useStore(useShallow(selectPanelParams))
  const requestedScale = useStore(selectScale)
  const mode = useStore(s => s.mode)
  const viewMode = useStore(s => s.viewMode)
  const setViewMode = useStore(s => s.setViewMode)
  const setFitScale = useStore(s => s.setFitScale)
  const [stalled, setStalled] = useState(false)
  const stallTimer = useRef(0)
  const armedOnce = useRef(false)

  const disarm = useCallback((): void => {
    window.clearTimeout(stallTimer.current)
    setStalled(false)
  }, [])

  const arm = useCallback((): void => {
    window.clearTimeout(stallTimer.current)
    setStalled(false)
    stallTimer.current = window.setTimeout(() => setStalled(true), STALL_MS)
  }, [])

  // The GPU's backing-store limit, known once the renderer exists. Until then
  // the absolute cap stands in, which is never the binding one in practice.
  const [maxOutput, setMaxOutput] = useState(MAX_OUTPUT_SIZE)

  // Whichever source is live sizes the element: the dropped file's 1x pixels
  // in image mode, the target viewport otherwise.
  const source = imageFrame
    ? { width: imageFrame.frameWidth, height: imageFrame.frameHeight }
    : viewport

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
  // 1:1 — and minifies through the renderer's smooth sampler, because
  // nearest decimation at a small fraction moirés.
  const fit = viewMode === 'fit'
  const scale = fit
    ? computeFitScale(pane.width, pane.height, dpr, source.width, source.height, oneToOne)
    : oneToOne

  // The footer reads fit's actual magnification from the store; null outside
  // fit mode. Tracks the pane, the viewport and the 1:1 scale by deps.
  useEffect(() => {
    setFitScale(fit ? scale : null)
  }, [fit, scale, setFitScale])
  // The setter is stable, so this cleanup runs on unmount only: a torn-down
  // canvas must not leave a stale fit readout in the store.
  useEffect(() => () => setFitScale(null), [setFitScale])

  // Read by the frame callback, which is installed once and must not go stale.
  const draw = useRef({ scale, params, smooth: fit })
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
    let raf = 0

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
        onFatal(e instanceof Error ? e.message : 'WebGL2 is not available')
        return false
      }
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
        if (useStore.getState().mode !== 'url') return
        // Trust the message's dims: frames painted against the previous
        // viewport are still in flight for a moment after a resize.
        gl.resizeSource(m.frameWidth, m.frameHeight)
        gl.uploadSlice(m.frame)
        schedule()
      })
      return true
    }
    const stop = (): void => {
      offFrame?.()
      offFrame = null
      if (raf !== 0) cancelAnimationFrame(raf)
      raf = 0
      gl?.dispose()
      gl = null
      glRef.current = null
    }

    // Minimal context-loss handling: preventDefault keeps the context
    // restorable; on restore, rebuild the renderer and resubscribe.
    const onLost = (e: Event): void => {
      e.preventDefault()
      stop()
    }
    const onRestored = (): void => {
      start()
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
        if (useStore.getState().viewMode !== '1:1') return
        const body = canvas.closest('.pane-body')
        if (body instanceof HTMLElement) {
          body.scrollLeft += e.deltaX
          body.scrollTop += e.deltaY
        }
        return
      }
      // A plain wheel forwards in fit mode too, so the page can be browsed
      // from the overview.
      if (useStore.getState().mode !== 'url') return
      e.preventDefault()
      const r = canvas.getBoundingClientRect()
      const ev = wheelEvent(e, r, draw.current.scale / (window.devicePixelRatio || 1))
      if (ev) window.obsrv.sendInput(ev)
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })

    // A drag that ends off the canvas must still release the button in the
    // target, or it keeps dragging until the next click. Leaving the canvas
    // mid-drag is deliberately *not* a release: the pointer can come back
    // (a scrollbar drag, a selection that overshoots the edge), and the
    // target's own button state is what decides when the drag ends.
    const onWindowUp = (e: MouseEvent): void => {
      if (useStore.getState().mode !== 'url') return
      // Same forwarding rules as `send`: fit mode and the pan chords never
      // forward, and Option only suppresses a release that is not completing
      // a forwarded drag.
      if (useStore.getState().viewMode !== '1:1') return
      if (panRef.current || e.button === 1) return
      if (e.altKey && !forwardDrag.current) return
      if (e.target === canvas) return // the canvas's own onMouseUp sent it
      const r = canvas.getBoundingClientRect()
      const ev = mouseEvent('mouseUp', e, r, draw.current.scale / (window.devicePixelRatio || 1))
      if (ev) {
        window.obsrv.sendInput(ev)
        forwardDrag.current = false
      }
    }
    window.addEventListener('mouseup', onWindowUp)

    const started = start()

    return () => {
      if (started) stop()
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      canvas.removeEventListener('wheel', onWheel)
      window.removeEventListener('mouseup', onWindowUp)
    }
  }, [onFatal, disarm])

  // Arm on a main-frame, cross-document navigation only — not on
  // `targetLoading`, which also rises for a subframe load: an iframe on a
  // healthy static page changes no pixel and owes no frame, so a watchdog
  // keyed to loading would cry wolf on it. (`targetLoading` still drives the
  // toolbar spinner.) Image mode never arms: main stops target frames on
  // `setMode('image')` by design, so "no frame" is the normal state there,
  // and a Cmd+R that reloads the hidden panes is tolerated for the same
  // reason.
  useEffect(
    () =>
      window.obsrv.onTargetNavigating(() => {
        if (useStore.getState().mode === 'url') arm()
      }),
    [arm],
  )

  useEffect(() => {
    if (mode !== 'url') disarm()
  }, [mode, disarm])

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
  }, [viewport.width, viewport.height, mode, arm])

  useEffect(() => () => window.clearTimeout(stallTimer.current), [])

  // Scale, panel params and the view mode can change without a new frame.
  useEffect(() => {
    draw.current = { scale, params, smooth: fit }
    const gl = glRef.current
    if (gl && gl.sourceWidth > 0) gl.draw(draw.current)
  }, [scale, params, fit])

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
    if (viewMode !== '1:1') return
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

  // A click in fit mode is the way back: 1:1 with the clicked target pixel
  // centred. The scroll applies in a layout effect, after React has
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
    if (viewMode !== 'fit') return
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

  // Every bridge builder may return null (unnamed button, pinch gesture,
  // dead key); those events are dropped, never sent as something else.
  const send =
    (type: 'mouseDown' | 'mouseUp' | 'mouseMove') =>
    (e: ReactMouseEvent<HTMLCanvasElement>): void => {
      if (mode !== 'url') return
      // Fit mode and the pan chords own the pointer: nothing forwards from
      // the overview, while a pan is live, or for the middle button (the pan
      // gesture's own press and release included). Option suppresses new
      // gestures and idle hovers only — see `forwardDrag`.
      if (viewMode !== '1:1' || panRef.current || e.button === 1) return
      if (e.altKey && !forwardDrag.current) return
      const out = mouseEvent(type, e, e.currentTarget.getBoundingClientRect(), scale / dpr)
      if (out) {
        window.obsrv.sendInput(out)
        if (type === 'mouseDown') forwardDrag.current = true
        else if (type === 'mouseUp') forwardDrag.current = false
      }
    }

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
      {stalled && (
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
      )}
      <div className="target-wrap">
        <canvas
          ref={canvasRef}
          className={`target-canvas${fit ? ' fit' : panning ? ' panning' : altHeld ? ' pan-ready' : ''}`}
          tabIndex={0}
          style={{ width: `${cssW}px`, height: `${cssH}px` }}
          onClick={jumpTo1x}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={e => endPan(e, false)}
          onPointerCancel={e => endPan(e, true)}
          onMouseDown={send('mouseDown')}
          onMouseUp={send('mouseUp')}
          onMouseMove={send('mouseMove')}
          // No onMouseLeave release: the window mouseup listener above catches
          // a release that lands outside the canvas, and a drag that crosses
          // the edge and comes back stays a drag.
          onKeyDown={e => {
            // Fit is a look, not a session: keys never forward from it.
            if (mode !== 'url' || viewMode !== '1:1') return
            // Leave shortcuts to the OS and the app menu.
            if (!e.metaKey && !e.ctrlKey) e.preventDefault()
            for (const ev of keyDownEvents(e)) window.obsrv.sendInput(ev)
          }}
          onKeyUp={e => {
            if (mode !== 'url' || viewMode !== '1:1') return
            const ev = keyUpEvent(e)
            if (ev) window.obsrv.sendInput(ev)
          }}
        />
      </div>
    </>
  )
}
