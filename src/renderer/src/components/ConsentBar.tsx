import { useEffect, useState } from 'react'
import { useStore } from '../state/store'

/**
 * The only new UI of the live-first spec: shown when a second launch knocks
 * while agent control is off — the one moment an MCP tool cannot ask the
 * user itself, so the app does. Non-modal, under the toolbar, and names that
 * an *agent* is asking. `Allow` is for this session only, exactly the rule
 * `OBSRV_AGENT_CONTROL=1` already follows; `Not now` leaves the app exactly
 * as it was.
 */
export function ConsentBar() {
  const [asked, setAsked] = useState(false)
  const agentControl = useStore(s => s.settings.agentControl)

  useEffect(() => window.obsrv.onAgentConsentRequest(() => setAsked(true)), [])
  // The user turned it on some other way while the bar was up — the settings
  // toggle, or a knock this same bar already answered.
  useEffect(() => {
    if (agentControl) setAsked(false)
  }, [agentControl])

  if (!asked || agentControl) return null

  const answer = (allow: boolean): void => {
    setAsked(false)
    if (allow) {
      // Optimistic, like the AGENT chip's own off switch: main's reply
      // travels back over `onSettingsChanged` too, but the toolbar should
      // not wait a round trip to show what the user just did.
      const current = useStore.getState().settings
      useStore.getState().setSettings({ ...current, agentControl: true })
    }
    window.obsrv.agentConsent(allow)
  }

  return (
    <div className="consent-bar" role="status">
      <span>An agent wants to drive Obsrv.</span>
      <button type="button" className="consent-allow" onClick={() => answer(true)}>
        Allow for this session
      </button>
      <button type="button" className="consent-deny" onClick={() => answer(false)}>
        Not now
      </button>
    </div>
  )
}
