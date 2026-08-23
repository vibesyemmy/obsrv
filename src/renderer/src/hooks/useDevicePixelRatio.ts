import { useEffect, useState } from 'react'

/**
 * The window's current `devicePixelRatio`, re-read when it changes — which
 * happens when the window is dragged between a 1x and a 2x display. The
 * canvas CSS box and the input maths both divide by it, so a stale value
 * would resample the pane and misplace every click until the next render.
 *
 * `matchMedia('(resolution: Ndppx)')` matches exactly while the ratio is N
 * and fires `change` the moment it stops matching; the listener is
 * reinstalled for the new ratio on every change.
 */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)

  useEffect(() => {
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = (): void => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dpr])

  return dpr
}
