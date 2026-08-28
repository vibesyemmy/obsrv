import { useShallow } from 'zustand/react/shallow'
import { canAddTab, tabTitle } from '../../../shared/tabList'
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

  const canAdd = canAddTab(tabOrder.length, maxTabs)

  return (
    <div className="chrome-row chrome-tabs">
      <div className="tabs" role="tablist" aria-label="Open tabs">
        {tabOrder.map(id => (
          <Tab key={id} id={id} active={id === activeId} />
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

function Tab({ id, active }: { id: string; active: boolean }) {
  // Subscribed per tab, so a background tab's title landing re-renders that
  // one entry rather than the whole strip.
  const label = useStore(s => {
    const t = s.tabs[id]
    return t ? tabTitle(t.url, t.title) : ''
  })

  return (
    <div className="tab">
      <button
        className="tab-label"
        type="button"
        role="tab"
        aria-selected={active}
        // The strip truncates; the full label belongs somewhere readable.
        title={label}
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
