import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/600.css'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

/**
 * The renderer only works inside Electron: `window.obsrv` is injected by the
 * preload. In a plain browser tab (e.g. the Vite dev server opened directly)
 * render a notice instead of letting the shell crash on the missing bridge.
 */
function BrowserNotice() {
  return (
    <div className="browser-notice" role="note">
      <strong>This is only Obsrv's renderer shell.</strong>
      <p>
        You are viewing the Vite dev server in a regular browser, where the
        Electron bridge (<code>window.obsrv</code>) does not exist — no panes,
        no 1x rendering.
      </p>
      <p>
        The real app is the <strong>Obsrv desktop window</strong> opened by{' '}
        <code>npm run dev</code>. Use that.
      </p>
    </div>
  )
}

createRoot(document.getElementById('root')!).render('obsrv' in window ? <App /> : <BrowserNotice />)
