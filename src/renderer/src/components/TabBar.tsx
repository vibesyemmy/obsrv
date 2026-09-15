import { useCallback, useState } from 'react'
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
 * Dragging a tab re-orders the strip, and takes that same round trip: the drop
 * sends `moveTab` and the strip moves when the snapshot returns. Identity is
 * the id, and `TabManager.activeIndex` is derived from it, so a re-order can
 * shuffle the list without the active tab changing or `tabs.json` coming back
 * pointing at whatever slid into the old position.
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

  // Drag state is local and deliberately not in the store: it lives for the
  // length of one gesture, and main is told once, at the drop. The strip
  // re-orders when the `tabsChanged` snapshot comes back — the same round trip
  // every other tab command takes, so a drop that main refuses leaves the
  // strip as it was rather than showing a move that did not happen.
  const [dragId, setDragId] = useState<string | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const endDrag = useCallback(() => {
    setDragId(null)
    setOverIndex(null)
  }, [])
  const drop = useCallback(
    (index: number) => {
      if (dragId !== null) window.obsrv.moveTab(dragId, index)
      endDrag()
    },
    [dragId, endDrag],
  )

  return (
    <div className="chrome-row chrome-tabs">
      <div className="tabs" role="tablist" aria-label="Open tabs">
        {tabOrder.map((id, index) => (
          <Tab
            key={id}
            id={id}
            index={index}
            active={id === activeId}
            driven={driving && id === activeId}
            busy={agentActive}
            dragging={dragId === id}
            over={overIndex === index && dragId !== null && dragId !== id}
            onDragStart={setDragId}
            onDragEnd={endDrag}
            onDragOver={setOverIndex}
            onDrop={drop}
          />
        ))}
      </div>
      <button
        className="tab-new"
        type="button"
        aria-label="New tab"
        disabled={!canAdd}
        // The cap exists because each tab is two Chromium renderers and the
        // processes behind them — twelve empty tabs measured 27 child
        // processes and about 2.5 GB — so the refusal says what it costs and
        // where to change it. A disabled button with no explanation reads as
        // a bug.
        title={
          canAdd
            ? 'New tab'
            : `${maxTabs} tabs is the limit — each one is two Chromium renderers, and twelve tabs cost about 2.5 GB. Raise it in Settings.`
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
  index,
  dragging,
  over,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: {
  id: string
  active: boolean
  /** Agent control is on and this is the tab its commands land on. */
  driven: boolean
  /** A command arrived in the last ~3 s; only ever shown on a driven tab. */
  busy: boolean
  /** This tab's position in the strip, which is what a drop lands on. */
  index: number
  dragging: boolean
  over: boolean
  onDragStart: (id: string) => void
  onDragEnd: () => void
  onDragOver: (index: number) => void
  onDrop: (index: number) => void
}) {
  // Subscribed per tab, so a background tab's title landing re-renders that
  // one entry rather than the whole strip.
  const label = useStore(s => {
    const t = s.tabs[id]
    return t ? tabTitle(t.url, t.title) : ''
  })

  return (
    <div
      className={`tab${driven ? ' driven' : ''}${driven && busy ? ' busy' : ''}${dragging ? ' dragging' : ''}${over ? ' drop-before' : ''}`}
      // The whole tab is the drag handle, which is what every browser does —
      // the label is a button, so dragging from it would otherwise be a
      // text-selection gesture.
      draggable
      onDragStart={e => {
        e.dataTransfer.effectAllowed = 'move'
        // Firefox refuses to start a drag with an empty data transfer.
        e.dataTransfer.setData('text/plain', id)
        onDragStart(id)
      }}
      onDragEnd={onDragEnd}
      onDragOver={e => {
        // Without this the drop never fires: the default is "no".
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        onDragOver(index)
      }}
      onDrop={e => {
        e.preventDefault()
        onDrop(index)
      }}
    >
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
