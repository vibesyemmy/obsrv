import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'

vi.mock('electron', () => ({ app: { isPackaged: true }, BrowserWindow: class {} }))

const { showWindow } = await import('../../src/main/window')

/**
 * How the main window is shown (bug-e2e-takes-the-desk). Under the harness it
 * must not become key, must not activate the app, and must let clicks pass
 * through. A user's launch, and a harness app launched to take the desk, show
 * it normally.
 */
function fakeWindow() {
  const calls: string[] = []
  const win = {
    show: () => calls.push('show'),
    showInactive: () => calls.push('showInactive'),
    setFocusable: (f: boolean) => calls.push(`setFocusable(${f})`),
    setIgnoreMouseEvents: (i: boolean) => calls.push(`setIgnoreMouseEvents(${i})`),
  }
  return { win: win as unknown as BrowserWindow, calls }
}

const ENV = ['OBSRV_TEST', 'OBSRV_SHOW_INACTIVE', 'OBSRV_TEST_TAKES_THE_DESK'] as const

describe('showWindow', () => {
  const saved: Partial<Record<(typeof ENV)[number], string>> = {}
  beforeEach(() => {
    for (const k of ENV) {
      saved[k] = process.env[k]
      delete process.env[k]
    }
  })
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('under the harness: never key, then shown without activating, then click-through, in that order', () => {
    process.env['OBSRV_TEST'] = '1'
    const { win, calls } = fakeWindow()
    showWindow(win)
    expect(calls).toEqual(['setFocusable(false)', 'showInactive', 'setIgnoreMouseEvents(true)'])
  })

  it('for a real launch that asks not to activate (OBSRV_SHOW_INACTIVE), the same', () => {
    process.env['OBSRV_SHOW_INACTIVE'] = '1'
    const { win, calls } = fakeWindow()
    showWindow(win)
    expect(calls).toEqual(['setFocusable(false)', 'showInactive', 'setIgnoreMouseEvents(true)'])
  })

  it("for a user's launch, and for a harness app launched to take the desk: shown as usual, and nothing else", () => {
    const user = fakeWindow()
    showWindow(user.win)
    expect(user.calls).toEqual(['show'])
    process.env['OBSRV_TEST'] = '1'
    process.env['OBSRV_TEST_TAKES_THE_DESK'] = '1'
    const desk = fakeWindow()
    showWindow(desk.win)
    expect(desk.calls).toEqual(['show'])
  })
})
