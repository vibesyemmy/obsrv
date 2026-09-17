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
  /** How many pings went unanswered past the deadline, for an assertion or a note. */
  misses(): number
}

export function armRendererPing(app: ElectronApplication, label: string, everyMs = 500, lateAfterMs = 1000): RendererPing {
  let misses = 0
  let stopped = false

  const timer = setInterval(() => {
    if (stopped) return
    const sent = Date.now()
    let answered = false
    void app
      .evaluate(async ({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        if (!w) return false
        await w.webContents.executeJavaScript('1')
        return true
      })
      .then(() => {
        answered = true
        const took = Date.now() - sent
        if (took > lateAfterMs) {
          misses++
          console.log(`[renderer-ping ${label}] LATE: answered after ${took}ms (sent ${new Date(sent).toISOString()})`)
        }
      })
      .catch(() => undefined)
    setTimeout(() => {
      if (answered || stopped) return
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
  }
}
