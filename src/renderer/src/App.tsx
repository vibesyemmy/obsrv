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
    void window.obsrv.getHostInfo().then(setHost)
    void window.obsrv.getSettings().then(setSettings)
    const offs = [
      window.obsrv.onHostChanged(setHost),
      window.obsrv.onUrlChanged(setUrl),
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
