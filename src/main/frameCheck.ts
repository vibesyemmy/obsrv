/**
 * Whether the frame the pane painted is the frame main last sent it.
 *
 * A live capture settles on main's side — a fresh frame from the target,
 * then quiet — asks the renderer to draw, and photographs the window. Once,
 * on the first live call after the app had launched, the photograph was the
 * previous page at the previous preset while the status beside it named the
 * new page: main had seen its frames, the pane had not drawn them. Frames
 * and the draw request share one ordered channel, so the request cannot
 * overtake a frame; what can happen is that the frame never reached the
 * canvas at all — delivery had not been subscribed yet, or the renderer
 * dropped it while its store did not yet call the tab a URL tab. Either way
 * the capture is of an older frame, and until now said nothing.
 *
 * So every frame the bus sends carries a sequence number, the renderer's
 * draw acknowledgement carries the number of the last frame it uploaded, and
 * the capture compares. This is the comparison, kept pure so it is tested.
 */
export function frameIdentityWarning(acked: number | null, latest: number, ready: boolean): string | null {
  if (!ready) {
    return 'frames are not being delivered to the pane (the renderer has not subscribed yet), so the capture shows whatever the pane last drew'
  }
  if (latest === 0) return null
  if (acked === null) return 'the renderer did not say which frame it drew, so the capture may show an older frame than the target painted'
  if (acked < latest) {
    return `the pane may show an older frame: the renderer drew frame ${acked}, the latest sent to it is ${latest}`
  }
  return null
}
