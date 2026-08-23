/** Spec §9: without WebGL2 there is no target pane, so there is no app. */
export function Fatal({ message }: { message: string }) {
  return (
    <div className="fatal" role="alertdialog" aria-labelledby="fatal-title">
      <h1 id="fatal-title">Obsrv can’t start</h1>
      <p>{message}</p>
      <p className="muted">
        The target pane is drawn with WebGL2. Without it there is nothing to show.
      </p>
    </div>
  )
}
