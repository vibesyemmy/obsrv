import { useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { GlRenderer } from '../gl/renderer'
import { useDevicePixelRatio } from '../hooks/useDevicePixelRatio'
import { keyDownEvents, keyUpEvent, mouseEvent, wheelEvent } from '../input/inputBridge'
import { selectPanelParams, selectScale, selectViewport, useStore } from '../state/store'

export interface TargetCanvasProps {
  onFatal: (message: string) => void
}

export function TargetCanvas({ onFatal }: TargetCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const glRef = useRef<GlRenderer | null>(null)

  const viewport = useStore(useShallow(selectViewport))
  const params = useStore(useShallow(selectPanelParams))
  const scale = useStore(selectScale)
  const mode = useStore(s => s.mode)

  // Read by the frame callback, which is installed once and must not go stale.
  const draw = useRef({ scale, params })

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
      offFrame = window.obsrv.onFrame(m => {
        if (!gl) return
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
      if (e.target === canvas) return // the canvas's own onMouseUp sent it
      const r = canvas.getBoundingClientRect()
      const ev = mouseEvent('mouseUp', e, r, draw.current.scale / (window.devicePixelRatio || 1))
      if (ev) window.obsrv.sendInput(ev)
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
  }, [onFatal])

  // Scale and panel params can change without a new frame arriving.
  useEffect(() => {
    draw.current = { scale, params }
    const gl = glRef.current
    if (gl && gl.sourceWidth > 0) gl.draw({ scale, params })
  }, [scale, params])

  // Re-read when the window moves between a 1x and a 2x display; the CSS
  // box and the input maths below both depend on it.
  const dpr = useDevicePixelRatio()

  // Every bridge builder may return null (unnamed button, pinch gesture,
  // dead key); those events are dropped, never sent as something else.
  const send =
    (type: 'mouseDown' | 'mouseUp' | 'mouseMove') =>
    (e: ReactMouseEvent<HTMLCanvasElement>): void => {
      if (mode !== 'url') return
      const out = mouseEvent(type, e, e.currentTarget.getBoundingClientRect(), scale / dpr)
      if (out) window.obsrv.sendInput(out)
    }

  // Backing store is `round(viewport × S)` device pixels (the rounding is
  // `GlRenderer.draw`'s); the CSS box divides that back out so the browser
  // maps it 1:1 instead of resampling. For the moment after a viewport change
  // when frames of the old size are still arriving, the backing store lags
  // this box — those frames are stale by definition.
  const cssW = Math.round(viewport.width * scale) / dpr
  const cssH = Math.round(viewport.height * scale) / dpr

  return (
    <canvas
      ref={canvasRef}
      className="target-canvas"
      tabIndex={0}
      style={{ width: `${cssW}px`, height: `${cssH}px` }}
      onMouseDown={send('mouseDown')}
      onMouseUp={send('mouseUp')}
      onMouseMove={send('mouseMove')}
      // No onMouseLeave release: the window mouseup listener above catches
      // a release that lands outside the canvas, and a drag that crosses the
      // edge and comes back stays a drag.
      onKeyDown={e => {
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
  )
}
