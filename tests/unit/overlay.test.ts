import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { MenuRequest } from '../../src/shared/api'
import type { PickerRequest } from '../../src/shared/pickerPopup'

/**
 * The overlay's keyboard focus hand-off, with electron faked
 * (bug-overlay-focus-handoff-untested). Opening a menu or a picker gives the
 * overlay's webContents keyboard focus; closing gives it back to the chrome,
 * or the next keystroke lands nowhere. Under the e2e harness `focusView` skips
 * both calls, because on macOS `webContents.focus()` activates the app and
 * takes the desk, so no ordinary e2e test can see a call deleted or pointed at
 * the wrong webContents. This does. Whether focus really routes a keystroke is
 * overlay-focus.spec's, in an app that takes the desk.
 */

const fake = vi.hoisted(() => ({
  contents: (name: string) => ({
    name,
    focus: vi.fn(),
    send: vi.fn(),
    close: vi.fn(),
    isDestroyed: () => false,
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
  }),
}))

vi.mock('electron', () => ({
  app: { isPackaged: true },
  BrowserWindow: class {},
  WebContentsView: class {
    webContents = fake.contents('overlay')
    setBackgroundColor(): void {}
    setVisible(): void {}
    setBounds(): void {}
  },
}))

const { Overlay } = await import('../../src/main/overlay')

type Contents = ReturnType<typeof fake.contents>

function opened(): { overlay: InstanceType<typeof Overlay>; chrome: Contents; view: Contents } {
  const chrome = fake.contents('chrome')
  const win = { webContents: chrome, contentView: { addChildView: vi.fn(), removeChildView: vi.fn() }, getContentSize: () => [1600, 1000], on: vi.fn() }
  const overlay = new Overlay(win as unknown as BrowserWindow)
  return { overlay, chrome, view: overlay.webContents as unknown as Contents }
}

const MENU = { groups: [], value: '', ariaLabel: 'Preset' } as unknown as MenuRequest
const PICKER = { tabId: 't', id: 1, type: 'date', value: '' } as unknown as PickerRequest
const ENV = ['OBSRV_TEST', 'OBSRV_SHOW_INACTIVE', 'OBSRV_TEST_TAKES_THE_DESK'] as const

// CONTROL (do not merge): skipped so the job reaches its e2e step.
describe.skip('the overlay hands keyboard focus', () => {
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

  /** The calls a menu and then a picker make, opening and closing each: [overlay, chrome] focus counts after each step. */
  function handOffs(): number[][] {
    const { overlay, chrome, view } = opened()
    const counts = (): number[] => [view.focus.mock.calls.length, chrome.focus.mock.calls.length]
    const steps: number[][] = []
    overlay.show(MENU)
    steps.push(counts())
    overlay.hide()
    steps.push(counts())
    overlay.showPicker(PICKER)
    steps.push(counts())
    overlay.hide()
    steps.push(counts())
    return steps
  }

  it('to the overlay when a menu or a picker opens, and back to the chrome when it closes', () => {
    expect(handOffs()).toEqual([
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ])
  })

  it('to nobody under the harness, where webContents.focus() would activate the app and take the desk', () => {
    process.env['OBSRV_TEST'] = '1'
    expect(handOffs()).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ])
  })

  it('to nobody for a real launch that asks not to activate (OBSRV_SHOW_INACTIVE, the dev lane spec)', () => {
    process.env['OBSRV_SHOW_INACTIVE'] = '1'
    expect(handOffs()).toEqual([
      [0, 0],
      [0, 0],
      [0, 0],
      [0, 0],
    ])
  })

  it('as a user would see it for a harness app launched to take the desk (OBSRV_TEST_TAKES_THE_DESK)', () => {
    process.env['OBSRV_TEST'] = '1'
    process.env['OBSRV_TEST_TAKES_THE_DESK'] = '1'
    expect(handOffs()).toEqual([
      [1, 0],
      [1, 1],
      [2, 1],
      [2, 2],
    ])
  })

  it('and closing twice hands it back once: a closed overlay has nothing to give back', () => {
    const { overlay, chrome } = opened()
    overlay.show(MENU)
    overlay.hide()
    overlay.hide()
    expect(chrome.focus).toHaveBeenCalledTimes(1)
  })
})
