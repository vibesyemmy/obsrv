import { useState, type FormEvent } from 'react'
import { EmptyArt } from '../illustrations/EmptyArt'
import { useStore } from '../state/store'

/**
 * What a tab shows before it has an address: the illustration plus the one
 * control that gets you out of the state.
 *
 * The field calls `window.obsrv.navigate` and stores the URL main hands back,
 * exactly as the toolbar's does — normalisation, scheme rejection and history
 * all live behind that call, so there is one behaviour to get right rather
 * than two that can drift. A failure leaves the state up with its message,
 * because the alternative is an empty pane and no explanation.
 */
export function EmptyState() {
  const setUrl = useStore(s => s.setUrl)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const url = draft.trim()
    if (url === '' || busy) return
    setBusy(true)
    setError(null)
    try {
      setUrl(await window.obsrv.navigate(url))
    } catch {
      setError('That address could not be loaded.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="empty-state">
      <EmptyArt />
      <p className="empty-lede">Point Obsrv at a page to see it the way a 1x screen does.</p>
      <form className="empty-form" onSubmit={submit}>
        <input
          className="empty-input"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          placeholder="localhost:3000"
          aria-label="URL to open"
          spellCheck={false}
          autoFocus
        />
        <button type="submit" className="empty-go" disabled={draft.trim() === '' || busy}>
          Open
        </button>
      </form>
      {error && (
        <p className="empty-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
