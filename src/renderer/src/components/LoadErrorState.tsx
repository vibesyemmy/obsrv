import { LoadErrorArt } from '../illustrations/LoadErrorArt'
import { useStore, selectTab } from '../state/store'

/**
 * What a tab shows when its address would not load.
 *
 * A failed load leaves *both* panes empty — measured: a bad host replaces a
 * good page with nothing, and Chromium commits no error page of its own here,
 * firing `did-fail-load` alone. Before this, all that said so was the numeric
 * code in the toolbar badge, with the description hidden in its tooltip; the
 * window itself was a blank rectangle with no way out of it.
 *
 * Spans both panes, like `EmptyState`, which main makes possible by standing
 * the native view down for a tab wearing a load error (`nativeVisible`): the
 * view is an OS-composited layer, so nothing the renderer paints could appear
 * over it otherwise. Safe here precisely because that pane is empty too.
 *
 * Built as an empty state rather than a card, because it is the same kind of
 * moment: the tab has nothing to show and there is one way out. A bordered
 * panel in the middle of an empty window read as a dialog — something that
 * had appeared over the work — when nothing was behind it.
 *
 * The code itself is deliberately quiet — small, beside the description.
 * `ERR_NAME_NOT_RESOLVED` is what a person can act on; `-105` is what they
 * would have to look up.
 */
export function LoadErrorState() {
  const error = useStore(s => selectTab(s).error)
  if (!error) return null

  return (
    <div className="load-error-state" role="alert">
      <LoadErrorArt />
      <div className="load-error-text">
        <p className="load-error-lede">This address would not load.</p>
        <p className="load-error-url" title={error.url}>
          {error.url}
        </p>
        <p className="load-error-why">
          {error.description}
          <span className="load-error-code"> ({error.code})</span>
        </p>
      </div>
      <div className="load-error-actions">
        <button type="button" className="load-error-retry" onClick={() => window.obsrv.reload()}>
          Try again
        </button>
        <p className="load-error-hint">Or edit the address above.</p>
      </div>
    </div>
  )
}
