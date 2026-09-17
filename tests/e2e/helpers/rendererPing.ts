import type { ElectronApplication } from '@playwright/test'

/**
 * Asks the renderer a trivial question on a timer and says, with timestamps,
 * when it stops answering.
 *
 * **Why this exists, and why it is not one of the two obvious instruments.**
 * `bug-controls-blur-timeout`: `locator.blur()` timed out once in ~591 CI runs,
 * on an input Playwright had already **resolved** — so the renderer was
 * answering microseconds earlier, and then an `evaluate` never returned. The
 * artefact holds a call log and nothing else, and that is not bad luck. It is
 * what this failure does. Measured against a reproduction of it
 * (`probe/blur-hang`):
 *
 * - **Timing the handler from inside cannot fire.** A handler that never
 *   returns never reaches its exit line, and a blocked main thread runs no
 *   timer, no microtask and no console flush that could carry a partial
 *   reading out. Nothing inside a stuck renderer can report being stuck.
 * - **Electron's `unresponsive` stays silent.** It is the same observation from
 *   the main process, which is sound reasoning and still wrong: Chromium's hang
 *   monitor waits on *input acknowledgements*, and a blur driven through CDP
 *   queues none.
 * - **A ping sees it**, because it asks rather than waits: 27 unanswered in a
 *   20-second block, each stamped with when it was sent.
 *
 * **It runs from the test process, not from main**, so its own reporting cannot
 * be taken out by the thing it is watching: only the *renderer* hangs, and both
 * this poller and the main process it talks to keep running. Output goes
 * straight to the test log as each miss happens rather than being collected at
 * the end — a run that dies with the renderer wedged still leaves the evidence.
 *
 * Costs one round trip every `everyMs` while armed, and prints nothing at all
 * unless an answer is late. Arm it around the calls whose silence you want
 * explained, not for a whole suite.
 */
export interface RendererPing {
  /** Stops the poller. Safe to call twice. */
  stop(): void
  /** Pings that came back as an error rather than a silence, reported separately. */
  rejections(): number
  /**
   * How many pings went late or unanswered, for an assertion or a note. Counts
   * the renderer failing to answer, and only that — a rejection is in
   * `rejections()` and nothing to ping is in neither.
   *
   * A genuinely late answer can print after `stop()` — the round trip it
   * describes was still in flight — so a line may land after a summary that
   * did not count it. That is a real observation arriving late rather than a
   * stray, which is why it is kept.
   */
  misses(): number
}

export function armRendererPing(app: ElectronApplication, label: string, everyMs = 500, lateAfterMs = 1000): RendererPing {
  let misses = 0
  let stopped = false
  let saidNoWindow = false
  let rejections = 0
  const saidRejections = new Set<string>()

  const timer = setInterval(() => {
    if (stopped) return
    const sent = Date.now()
    let answered = false
    // Distinct from `answered`: there was nothing to ask, which is not the
    // renderer failing to answer. Folding the two into one count would give
    // `misses()` two meanings, which is the defect this instrument exists to
    // help find.
    let nothingToPing = false
    void app
      .evaluate(async ({ BrowserWindow }) => {
        // The SHELL renderer, chosen explicitly. The app also creates offscreen
        // windows for the target (`targetSource.ts`, a fresh one per preset
        // change), and `getAllWindows()[0]` is a convention rather than a
        // guarantee. For an instrument that is not good enough: "no misses"
        // has to rule out "pinged the wrong renderer", or a quiet run fits two
        // facts and the silence means nothing. (Wren, on #229.)
        const w = BrowserWindow.getAllWindows().find(win => !win.webContents.isOffscreen())
        if (!w) return 'no-window'
        await w.webContents.executeJavaScript('1')
        return 'ok'
      })
      .then(result => {
        // Said, not swallowed: an instrument that finds nothing to watch must
        // report that rather than read as a clean run. Once, because the
        // condition persists and a line every 500 ms would bury the log.
        if (result === 'no-window') {
          nothingToPing = true
          if (!saidNoWindow) {
            saidNoWindow = true
            console.log(`[renderer-ping ${label}] NO NON-OFFSCREEN WINDOW to ping — this run's silence is not evidence`)
          }
          return
        }
        answered = true
        const took = Date.now() - sent
        if (took > lateAfterMs) {
          misses++
          console.log(`[renderer-ping ${label}] LATE: answered after ${took}ms (sent ${new Date(sent).toISOString()})`)
        }
      })
      // A rejection is an ANSWER carrying an error, not a silence — and the
      // error says which: "Execution context was destroyed" is a renderer that
      // navigated or crashed mid-call, "Target … has been closed" is the app
      // going away. An earlier version of this comment claimed the two were
      // indistinguishable from here and let the timeout count them as
      // unanswered, which gave `misses()` two meanings and dressed the gap up
      // as a decision. The rejection hands over the distinguishing fact; there
      // was nothing to guess. (Wren, on #229.)
      .catch((e: unknown) => {
        answered = true
        rejections++
        const msg = e instanceof Error ? e.message.split('\n')[0]! : String(e)
        // Once per distinct message: the condition usually persists, and a
        // line every 500 ms would bury the log it exists to leave behind.
        if (!saidRejections.has(msg)) {
          saidRejections.add(msg)
          console.log(`[renderer-ping ${label}] REJECTED: ${msg} (sent ${new Date(sent).toISOString()})`)
        }
      })
    setTimeout(() => {
      // `nothingToPing` is set when the result arrives, so a 'no-window' answer
      // that itself came back slower than `lateAfterMs` has already been
      // counted here. Left alone: it would need the answer before the deadline
      // to prevent, which is the thing being measured.
      if (answered || stopped || nothingToPing) return
      misses++
      // Printed the moment it happens. A run that ends with the renderer
      // wedged still carries this line, which is the whole point.
      console.log(`[renderer-ping ${label}] UNANSWERED after ${lateAfterMs}ms (sent ${new Date(sent).toISOString()})`)
    }, lateAfterMs)
  }, everyMs)

  return {
    stop() {
      stopped = true
      clearInterval(timer)
    },
    misses: () => misses,
    rejections: () => rejections,
  }
}
