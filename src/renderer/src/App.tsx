import { useEffect, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Fatal } from './components/Fatal'
import { NativeSlot } from './components/NativeSlot'
import { TargetFooter } from './components/PaneFooter'
import { TargetCanvas } from './components/TargetCanvas'
import { Toolbar } from './components/Toolbar'
import { selectViewport, useStore } from './state/store'

export function App() {
  const [fatal, setFatal] = useState<string | null>(null)

  const setHost = useStore(s => s.setHost)
  const setSettings = useStore(s => s.setSettings)
  const setUrl = useStore(s => s.setUrl)
  const setError = useStore(s => s.setError)
  const setTargetLoading = useStore(s => s.setTargetLoading)
  const mode = useStore(s => s.mode)
  const surround = useStore(s => s.surround)
  const viewport = useStore(useShallow(selectViewport))

  // The store performs no IPC of its own; this is the one place that bridges.
  useEffect(() => {
    // A rejected query leaves the store's fallbacks in place (flat 2x scale,
    // default settings) rather than taking the app down before first paint.
    window.obsrv.getHostInfo().then(setHost, e => console.warn('obsrv: getHostInfo failed', e))
    window.obsrv.getSettings().then(setSettings, e => console.warn('obsrv: getSettings failed', e))
    const offs = [
      window.obsrv.onHostChanged(setHost),
      // A committed navigation — back, forward, reload, a link — supersedes
      // the last load failure. A *failed* load commits Chromium's error page
      // first and reports its error after, so the badge still lands last.
      window.obsrv.onUrlChanged(url => {
        setError(null)
        setUrl(url)
      }),
      window.obsrv.onLoadError(setError),
      window.obsrv.onTargetLoading(setTargetLoading),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [setHost, setSettings, setUrl, setError, setTargetLoading])

  useEffect(() => {
    void window.obsrv.setViewport(viewport.width, viewport.height)
  }, [viewport.width, viewport.height])

  useEffect(() => {
    window.obsrv.setMode(mode)
  }, [mode])

  // The surround control only repaints the field the panes sit in.
  useEffect(() => {
    document.documentElement.dataset.surround = surround
  }, [surround])

  if (fatal) return <Fatal message={fatal} />

  return (
    <div className="app">
      <Toolbar />
      <div className="panes">
        <NativeSlot />
        <div className="pane target-pane">
          <div className="pane-body">
            <TargetCanvas onFatal={setFatal} />
          </div>
          <TargetFooter />
        </div>
      </div>
    </div>
  )
}
