import { useState } from 'react'
import { diagonalHint, diagonalHintWords, recordDiagonalFor } from '../../../shared/diagonalHint'
import { useStore } from '../state/store'

/**
 * What the target pane says when the monitor diagonal the magnification
 * divides by is not known to be this screen's (`ux-first-launch-no-calibration`).
 *
 * `hostDiagonalInches` defaults to 27, and the first window never mentioned it:
 * on a smaller screen the target rendered below true physical size and nothing
 * said so, which is the one thing the pane exists to get right.
 *
 * **Answering is the only dismissal.** There is no bare ×: the confirm button
 * records this display without changing the number, and the other opens
 * Settings. A dismissal that recorded nothing would leave someone who really
 * has a 27″ screen reading this on every launch, which is worse than the thing
 * it warns about.
 *
 * **It sits above the footer rather than inside it.** `.pane-footer` is
 * `white-space: nowrap; overflow: hidden` (`styles.css`), so a sentence in that
 * strip would be clipped to nothing on a narrow pane — a warning nobody can
 * read is the silence this card is about.
 */
export function DiagonalHint({ onOpenSettings }: { onOpenSettings: () => void }) {
  const settings = useStore(s => s.settings)
  const host = useStore(s => s.host)
  const setSettings = useStore(s => s.setSettings)
  const [error, setError] = useState<string | null>(null)

  const hint = diagonalHint(settings, host)
  if (hint.kind === 'none') return null
  const words = diagonalHintWords(hint)

  // The store first, so the hint goes as the click is made, and a refusal from
  // main rolls it back and says so — the same shape as `SettingsPanel`'s commit.
  const confirm = (): void => {
    const next = recordDiagonalFor(settings, host)
    if (next === settings) return
    setSettings(next)
    setError(null)
    window.obsrv.setSettings(next).catch((e: unknown) => {
      setSettings(settings)
      setError(`Not saved: ${e instanceof Error ? e.message : String(e)}`)
    })
  }

  return (
    <div className="pane-hint" role="status">
      <span className="pane-hint-text">{words.message}</span>
      <button type="button" className="pane-hint-action" onClick={confirm}>
        {words.confirm}
      </button>
      <button type="button" className="pane-hint-action" onClick={onOpenSettings}>
        {words.set}
      </button>
      {error !== null && (
        <span className="pane-hint-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
