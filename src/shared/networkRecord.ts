/**
 * What a flow step asked the network for, for reproduction.
 *
 * `feat-flow-report`'s clause two wants the **network call** one click down from
 * each step. `#490` gated building it on a measurement — a record needs a
 * `webContents.debugger` session held for the flow, and `targetSource.ts:188`
 * warns that detaching such a session "wipes Electron's own emulation with it",
 * where emulation is the preset a flow runs under. `#504` measured it: the preset
 * survives an attach and a detach, so the record is safe to build.
 *
 * A reducer over the CDP events rather than a class that owns a session, so the
 * decisions here are testable without Electron, a debugger, or a page. `main`
 * feeds it whatever `Network.*` messages arrive and asks for the batch per step.
 */

/** One request, as the report shows it. Deliberately small: a QA engineer
 *  reproducing a step wants to know what it asked for and what came back, not a
 *  HAR. */
export interface NetworkRecord {
  method: string
  url: string
  /** Absent until a response arrives — a request still in flight when the step
   *  ended is a fact worth seeing, not a row to hide. */
  status?: number
  /** Chromium's own resource type (`Document`, `XHR`, `Image`, …), when it said. */
  type?: string
  /** CDP's id for the request, kept so a response can find its row. On the wire
   *  it is noise, and the report never shows it — but a parallel map would be a
   *  second place to keep in step with `records`, and at 50 rows a scan costs
   *  nothing. */
  requestId?: string
}

export interface NetworkState {
  /** Completed and in-flight requests, oldest first, capped. */
  records: NetworkRecord[]
  /** Requests dropped because the cap was reached, so a truncated batch cannot
   *  be mistaken for a quiet step. */
  dropped: number
  /** Set when recording stopped for a reason other than the flow ending —
   *  today, a debugger detach. **An empty batch means "no requests" only while
   *  this is absent**; with it, the batch means "recording died", and those are
   *  opposite findings that an empty list alone cannot distinguish. */
  stopped?: string
}

/** Per step. High enough that a real page's step fits, low enough that a runaway
 *  poller cannot grow the report without bound. */
export const MAX_NETWORK_RECORDS = 50

export function emptyNetworkState(): NetworkState {
  return { records: [], dropped: 0 }
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)

/**
 * Folds one CDP message into the state, in place, and answers whether it was
 * used — the caller logs nothing for a message it did not understand, which
 * keeps an unknown `Network.*` event from looking like a dropped request.
 *
 * Keyed on `requestId` for the response join. A response whose request was never
 * seen is kept as a record with no method rather than dropped: it happened, and
 * inventing `GET` for it would be a claim nobody measured.
 */
export function applyNetworkEvent(state: NetworkState, method: string, params: unknown): boolean {
  const p = (typeof params === 'object' && params !== null ? params : {}) as Record<string, unknown>
  const id = str(p['requestId'])
  if (method === 'Network.requestWillBeSent') {
    const req = (typeof p['request'] === 'object' && p['request'] !== null ? p['request'] : {}) as Record<string, unknown>
    const url = str(req['url'])
    if (url === undefined || id === undefined) return false
    if (state.records.length >= MAX_NETWORK_RECORDS) {
      state.dropped += 1
      return true
    }
    state.records.push({
      method: str(req['method']) ?? '(unknown method)',
      url,
      ...(str(p['type']) !== undefined ? { type: str(p['type'])! } : {}),
      requestId: id,
    })
    return true
  }
  if (method === 'Network.responseReceived') {
    const res = (typeof p['response'] === 'object' && p['response'] !== null ? p['response'] : {}) as Record<string, unknown>
    const status = num(res['status'])
    if (id === undefined || status === undefined) return false
    const rec = state.records.find(r => r.requestId === id)
    // A response for a request this batch never saw — it began before the step
    // did, or the request event was dropped by the cap. Recorded with the status
    // it reported and no method, because the method is not knowable from here.
    if (rec === undefined) {
      if (state.records.length >= MAX_NETWORK_RECORDS) {
        state.dropped += 1
        return true
      }
      const url = str(res['url'])
      state.records.push({ method: '(response only)', url: url ?? '(unknown url)', status })
      return true
    }
    rec.status = status
    return true
  }
  return false
}

/** The batch for a step, and a fresh state for the next one. Taking resets, so
 *  each step's record is that step's own and a slow request appears under the
 *  step that was running when its response arrived. */
export function takeNetworkState(state: NetworkState): { batch: NetworkState; next: NetworkState } {
  const batch: NetworkState = { records: state.records, dropped: state.dropped, ...(state.stopped !== undefined ? { stopped: state.stopped } : {}) }
  const next = emptyNetworkState()
  // A stop persists: once the session is gone every later step is equally
  // unrecorded, and clearing it would make the next step read as a quiet one.
  if (state.stopped !== undefined) next.stopped = state.stopped
  return { batch, next }
}

/** A sentence for the report. Null when there is nothing to say beyond the rows
 *  themselves, so the renderer is not handed an empty paragraph. */
export function networkNote(state: NetworkState): string | null {
  if (state.stopped !== undefined) {
    return `Recording stopped, so this is not a list of every request: ${state.stopped}`
  }
  if (state.dropped > 0) {
    return `${state.dropped} more request${state.dropped === 1 ? '' : 's'} past the first ${MAX_NETWORK_RECORDS} are not listed.`
  }
  return null
}
