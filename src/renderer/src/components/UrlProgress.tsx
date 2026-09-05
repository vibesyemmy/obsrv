import { useEffect, useState } from 'react'

/**
 * Chrome's loading strip, inside the URL field: a hairline along the field's
 * bottom edge that runs while the target loads. Chromium reports no progress
 * figure, so the strip does what Chrome's does — jumps ahead, then creeps
 * towards the right and never quite arrives — and completes and fades when
 * the load stops. A load that ends in a beat still gets the completing
 * sweep, which is what tells the user something happened.
 *
 * The motion is CSS: one long transition towards 90% that a `data-go` flag
 * starts a frame after mount (a transition needs a change to run), and a
 * short one to 100% plus a fade for `done`. Each load is a fresh mount
 * (`run` keys it), so a strip still creeping, or still fading, starts from
 * zero rather than continuing where it was. The toolbar keys the component
 * by tab, so a switch mid-load shows the new tab's state, not the old strip.
 */
type Phase = 'loading' | 'done'

/** The completing sweep plus the fade; after this the strip is unmounted. */
export const URL_PROGRESS_FADE_MS = 400

export function UrlProgress({ loading }: { loading: boolean }) {
  const [phase, setPhase] = useState<Phase | null>(loading ? 'loading' : null)
  const [run, setRun] = useState(0)

  useEffect(() => {
    if (loading) {
      setRun(r => r + 1)
      setPhase('loading')
      return
    }
    // Not loading: a strip that was running completes; one already fading,
    // or none, is left alone.
    setPhase(p => (p === 'loading' ? 'done' : p))
  }, [loading])

  useEffect(() => {
    if (phase !== 'done') return
    const t = setTimeout(() => setPhase(null), URL_PROGRESS_FADE_MS)
    return () => clearTimeout(t)
  }, [phase, run])

  if (phase === null) return null
  return <Strip key={run} phase={phase} />
}

function Strip({ phase }: { phase: Phase }) {
  const [go, setGo] = useState(false)
  useEffect(() => {
    const id = requestAnimationFrame(() => setGo(true))
    return () => cancelAnimationFrame(id)
  }, [])
  return (
    <div
      className="url-progress"
      data-phase={phase}
      data-go={go ? '' : undefined}
      role="progressbar"
      aria-label="Loading the page"
      aria-valuetext={phase === 'done' ? 'loaded' : 'loading'}
    >
      <div className="url-progress-bar" />
    </div>
  )
}
