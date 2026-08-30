import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'
import { NativeFooter } from './PaneFooter'

/**
 * Holds the space the native `WebContentsView` occupies. The view is an
 * OS-level overlay that main positions, so this component's only job is to
 * measure its own rectangle and report it. The first report takes layout
 * ownership away from main's fallback (see `registerIpc`).
 */
export function NativeSlot() {
  const ref = useRef<HTMLDivElement>(null)
  const obscured = useStore(s => s.nativeObscured)
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const push = (): void => {
      const r = el.getBoundingClientRect()
      const bounds = {
        x: Math.round(r.left),
        y: Math.round(r.top),
        width: Math.round(r.width),
        height: Math.round(r.height),
      }
      window.obsrv.setNativeBounds(bounds)
      setSize({ width: bounds.width, height: bounds.height })
    }

    push()
    const ro = new ResizeObserver(push)
    ro.observe(el)
    window.addEventListener('resize', push)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', push)
    }
  }, [])

  // The slot excludes the footer, so the native view never covers the readout.
  return (
    <div className="pane">
      <div className="pane-body">
        <div className="native-slot" ref={ref}>
          {/* The view is off screen while a menu covers it; this is what the
              renderer draws in the space it vacated. */}
          {obscured && <div className="native-scrim" />}
        </div>
      </div>
      <NativeFooter width={size.width} height={size.height} />
    </div>
  )
}
