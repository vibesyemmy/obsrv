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
const NOT_DELIVERED =
  'frames are not being delivered to the pane (the renderer has not subscribed yet), so the capture shows whatever the pane last drew'
const NO_ACKNOWLEDGEMENT = 'the renderer did not say which frame it drew, so the capture may show an older frame than the target painted'
/** The numbered sentence's fixed half; the frame numbers follow it. */
const OLDER_FRAME = 'the pane may show an older frame:'

export function frameIdentityWarning(acked: number | null, latest: number, ready: boolean): string | null {
  if (!ready) return NOT_DELIVERED
  if (latest === 0) return null
  if (acked === null) return NO_ACKNOWLEDGEMENT
  if (acked < latest) return `${OLDER_FRAME} the renderer drew frame ${acked}, the latest sent to it is ${latest}`
  return null
}

/**
 * Whether a capture's warning is one of the three above — for a test that has
 * to know the capture doubted its own frame.
 *
 * Built from the same constants the sentences are, because a spec that matched
 * a COPY of the words would stop matching the day one is reworded, and a
 * reword is a minor (`docs/compatibility.md`). The assertion would then find
 * nothing, pass, and the test would be vacuous again — quietly, which is
 * exactly how `bug-hidden-window-capture-test-cannot-see-drawnow` began.
 */
export function isFrameIdentityWarning(warning: string): boolean {
  return warning === NOT_DELIVERED || warning === NO_ACKNOWLEDGEMENT || warning.startsWith(OLDER_FRAME)
}
