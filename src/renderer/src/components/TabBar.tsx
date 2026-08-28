import { useShallow } from 'zustand/react/shallow'
import { canAddTab, tabTitle } from '../../../shared/tabList'
import { useAgentActivity } from '../hooks/useAgentActivity'
import { useStore } from '../state/store'
import { Icon } from './Icon'

/**
 * The tab strip: the chrome's third row, above the browse row and so furthest
 * from the panes — where every browser puts it, and where it is least able to
 * bias a judgement about the pixels below.
 *
 * Every command goes to main and comes back as a `tabsChanged` snapshot rather
 * than being applied locally first. Main owns tab identity (a tab is the pair
 * of Chromium renderers it built), so an optimistic strip would be inventing
 * ids that no session answers to.
 *
 * Reordering is deliberately absent from this first cut — see the spec.
 */
export function TabBar() {
  const tabOrder = useStore(useShallow(s => s.tabOrder))
  const activeId = useStore(s => s.activeId)
  const maxTabs = useStore(s => s.settings.maxTabs)
  // While agent control is on, the agent acts on whichever tab is in front —
  // resolved per command, never bound at drive start — so the marker belongs
  // on the active tab and moves with it. `driving` is the standing fact (the
  // loopback server is open); `agentActive` is the last ~3 s of commands.
  const driving = useStore(s => s.settings.agentControl)
  const agentActive = useAgentActivity()

  const canAdd = canAddTab(tabOrder.length, maxTabs)

  return (
    <div className="chrome-row chrome-tabs">
      <div className="tabs" role="tablist" aria-label="Open tabs">
        {tabOrder.map(id => (
          <Tab
            key={id}
            id={id}
            active={id === activeId}
            driven={driving && id === activeId}
            busy={agentActive}
          />
        ))}
      </div>
      <button
        className="tab-new"
        type="button"
        aria-label="New tab"
        disabled={!canAdd}
        // The cap exists because each tab is two Chromium processes, so the
        // refusal says that and says where to change it. A disabled button
        // with no explanation reads as a bug.
        title={
          canAdd
            ? 'New tab'
            : `${maxTabs} tabs is the limit — each one is two Chromium processes. Raise it in Settings.`
        }
        onClick={() => {
          void window.obsrv.addTab()
        }}
      >
        <Icon name="plus" size={14} />
      </button>
    </div>
  )
}

function Tab({
  id,
  active,
  driven,
  busy,
}: {
  id: string
  active: boolean
  /** Agent control is on and this is the tab its commands land on. */
  driven: boolean
  /** A command arrived in the last ~3 s; only ever shown on a driven tab. */
  busy: boolean
}) {
  // Subscribed per tab, so a background tab's title landing re-renders that
  // one entry rather than the whole strip.
  const label = useStore(s => {
    const t = s.tabs[id]
    return t ? tabTitle(t.url, t.title) : ''
  })

  return (
    <div className={`tab${driven ? ' driven' : ''}${driven && busy ? ' busy' : ''}`}>
      <button
        className="tab-label"
        type="button"
        role="tab"
        aria-selected={active}
        // Two facts, one tooltip. The driven line is the only place the strip
        // explains its marker — an unlabelled rule on one tab reads as a
        // rendering artefact, and a screen reader would not see it at all.
        title={driven ? `${label}\nAgent control is driving this tab` : label}
        onClick={() => window.obsrv.activateTab(id)}
      >
        {label}
      </button>
      <button
        className="tab-close"
        type="button"
        aria-label={`Close ${label}`}
        title="Close tab"
        onClick={() => window.obsrv.closeTab(id)}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}
