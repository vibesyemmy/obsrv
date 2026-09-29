import { describe, expect, it } from 'vitest'
import {
  applyNetworkEvent,
  emptyNetworkState,
  MAX_NETWORK_RECORDS,
  detachedReason,
  networkNote,
  takeNetworkState,
  type NetworkState,
} from '../../src/shared/networkRecord'

/**
 * The decisions in the per-step network record, tested without Electron, a
 * debugger or a page — which is the reason it is a reducer rather than a class
 * that owns a session.
 *
 * The one this file exists for is the difference between **"this step made no
 * requests"** and **"recording died"**. Both are an empty list, they are opposite
 * findings, and a report that renders them the same way is the failure this
 * repo keeps naming.
 */
const sent = (id: string, url: string, method = 'GET', type?: string): [string, unknown] => [
  'Network.requestWillBeSent',
  { requestId: id, request: { url, method }, ...(type !== undefined ? { type } : {}) },
]
const received = (id: string, status: number, url?: string): [string, unknown] => [
  'Network.responseReceived',
  { requestId: id, response: { status, ...(url !== undefined ? { url } : {}) } },
]
const feed = (state: NetworkState, ...events: Array<[string, unknown]>): boolean[] =>
  events.map(([m, p]) => applyNetworkEvent(state, m, p))

describe('the per-step network record', () => {
  it('records a request and joins its response by id', () => {
    const s = emptyNetworkState()
    feed(s, sent('1', 'https://shop.test/cart', 'GET', 'Document'), received('1', 200))
    expect(s.records).toEqual([{ method: 'GET', url: 'https://shop.test/cart', type: 'Document', status: 200, requestId: '1' }])
  })

  it('keeps a request that never got a response, rather than dropping it', () => {
    const s = emptyNetworkState()
    feed(s, sent('1', 'https://shop.test/slow'))
    // In flight when the step ended is a fact a reproducer wants, so there is a
    // row with no status rather than no row.
    expect(s.records).toHaveLength(1)
    expect(s.records[0]!.status).toBeUndefined()
  })

  it('keeps a response whose request it never saw, and does not invent the method', () => {
    const s = emptyNetworkState()
    feed(s, received('9', 304, 'https://shop.test/logo.png'))
    expect(s.records).toEqual([{ method: '(response only)', url: 'https://shop.test/logo.png', status: 304 }])
  })

  it('ignores an event it does not understand, so an unknown CDP message is not a dropped request', () => {
    const s = emptyNetworkState()
    const used = feed(s, ['Network.webSocketCreated', { requestId: '1' }], ['Network.requestWillBeSent', { requestId: '1' }])
    // The second is a `requestWillBeSent` with no url — malformed, not a request.
    expect(used).toEqual([false, false])
    expect(s.records).toEqual([])
    expect(s.dropped).toBe(0)
  })

  it('counts what the cap dropped, so a truncated batch is not a quiet step', () => {
    const s = emptyNetworkState()
    for (let i = 0; i < MAX_NETWORK_RECORDS + 3; i++) feed(s, sent(String(i), `https://shop.test/${i}`))
    expect(s.records).toHaveLength(MAX_NETWORK_RECORDS)
    expect(s.dropped).toBe(3)
    expect(networkNote(s)).toContain('3 more requests')
  })

  /** The pair this file is for. */
  it('says nothing extra for a step that simply made no requests', () => {
    expect(networkNote(emptyNetworkState())).toBeNull()
  })

  it('says recording stopped when it did, so an empty list is not read as a quiet step', () => {
    const s = emptyNetworkState()
    s.stopped = 'the debugger session was detached (a throttle was lifted)'
    expect(s.records).toEqual([])
    const note = networkNote(s)
    expect(note).toContain('Recording stopped')
    expect(note).toContain('a throttle was lifted')
    // And it must not be mistakable for the cap message, which is a different
    // fact about a batch that IS otherwise complete.
    expect(note).not.toContain('past the first')
  })

  /**
   * The detach sentence, keyed on the reason rather than asserting a cause.
   * Idris found the original: it said "a throttle being lifted does this"
   * unconditionally, and the commonest trigger is a preset change replacing the
   * window, which Chromium reports as `target closed`.
   */
  it('names a replaced window as a replaced window, not as a lifted throttle', () => {
    const s = detachedReason('target closed')
    expect(s).toContain('the target window was replaced')
    expect(s).toContain('recording restarts on the next step')
    expect(s).not.toContain('throttle')
  })

  it('quotes an unrecognised reason instead of guessing a cause for it', () => {
    const s = detachedReason('something new')
    expect(s).toContain('something new')
    expect(s).not.toContain('throttle')
    expect(s).not.toContain('window was replaced')
  })

  it('says so when the reason is empty, rather than rendering an empty bracket', () => {
    expect(detachedReason('  ')).toContain('no reason given')
  })

  it('reports a stop on the batch it happened in and does not carry it further', () => {
    const s = emptyNetworkState()
    s.stopped = 'detached'
    const { batch, next } = takeNetworkState(s)
    expect(batch.stopped).toBe('detached')
    // It used to carry forward, on the reasoning that a dead session stays dead.
    // It does not: a detach resets the recorder's flag and the next call
    // re-attaches, so carrying the stop would make genuinely recorded steps claim
    // they were unrecorded — the same false-silence shape from the other side.
    expect(next.stopped).toBeUndefined()
    expect(next.records).toEqual([])
  })

  it('resets the records on take, so each step owns its own batch', () => {
    const s = emptyNetworkState()
    feed(s, sent('1', 'https://shop.test/a'))
    const { batch, next } = takeNetworkState(s)
    expect(batch.records).toHaveLength(1)
    expect(next.records).toEqual([])
    expect(next.dropped).toBe(0)
    expect(next.stopped).toBeUndefined()
  })
})
