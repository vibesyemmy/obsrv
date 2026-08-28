import { useEffect, useState } from 'react'

/**
 * How long the chrome stays lit after an agent-control command. Long enough
 * that a burst of commands reads as one continuous drive rather than a
 * flicker, short enough that a finished drive stops claiming to be running.
 */
export const AGENT_ACTIVITY_MS = 3_000

/**
 * True while an authenticated agent-control command arrived in the last
 * ~3 s, so the user can see the visible app is being driven.
 *
 * Two pieces of chrome say it: the toolbar's `AGENT` chip (agent control is
 * on, and busy) and the tab strip's driven-tab marker (which tab those
 * commands are landing on). They share this hook rather than one of them
 * threading state to the other — they are in different rows of the chrome
 * and neither owns the other — and each `onAgentActivity` registration is
 * its own listener with its own removal, so two subscribers cost one extra
 * callback and no coordination.
 */
export function useAgentActivity(): boolean {
  const [active, setActive] = useState(false)

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const off = window.obsrv.onAgentActivity(() => {
      setActive(true)
      clearTimeout(timer)
      timer = setTimeout(() => setActive(false), AGENT_ACTIVITY_MS)
    })
    return () => {
      clearTimeout(timer)
      off()
    }
  }, [])

  return active
}
