import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { PickerRequest } from '../../../shared/pickerPopup'

/**
 * The overlay's other job (see `MenuLayer`): an invisible input of the type
 * the target page's input has, laid over that input's box on the canvas, so
 * that Chromium's own picker — a calendar page popup, the colour panel —
 * opens onscreen where offscreen it could not. Main clicks the input once
 * as a user would, once this has reported it is in place; a synthetic
 * `showPicker()` needs an activation this page never got.
 *
 * The values are reported as they happen, not once at the end: a colour
 * being dragged fires `input` continuously and a page previewing it should
 * see each one. `change` says the picker committed, and main puts the view
 * away on it. The backdrop and Escape dismiss without a value.
 */
export function PickerHost() {
  const [request, setRequest] = useState<PickerRequest | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => window.obsrv.onPickerShow(setRequest), [])

  const close = (): void => {
    window.obsrv.closePicker()
    setRequest(null)
  }

  // Native listeners rather than React's: its `onChange` is the DOM's
  // `input`, and the distinction is the whole message.
  useLayoutEffect(() => {
    const el = inputRef.current
    if (!request || !el) return
    const onInput = (): void => window.obsrv.pickerEvent({ value: el.value, done: false })
    const onChange = (): void => {
      window.obsrv.pickerEvent({ value: el.value, done: true })
      setRequest(null)
    }
    // Chromium's picker dismissed without a value — Escape in the calendar,
    // the colour panel closed — fires `cancel` on the input. The host goes
    // with it, or the next keystroke would land in an invisible field.
    const onCancel = (): void => close()
    // Main's click is the user gesture `showPicker()` needs; a click on its
    // own would open the picker only where the input keeps its indicator
    // (a date field's calendar icon sits at its right end, and a click in
    // the middle picks a segment instead). The default is prevented so a
    // colour input, which opens on any click, does not open twice.
    const onClick = (e: MouseEvent): void => {
      e.preventDefault()
      // What happened is recorded on the element: Chromium throws when it
      // will not show a picker (no gesture, or nothing to show), and a test
      // has no other way to see a widget that lives outside the page.
      try {
        el.showPicker()
        el.dataset.shown = 'ok'
      } catch (err) {
        el.dataset.shown = err instanceof Error ? err.name : 'error'
      }
    }
    el.addEventListener('input', onInput)
    el.addEventListener('change', onChange)
    el.addEventListener('cancel', onCancel)
    el.addEventListener('click', onClick)
    el.focus()
    window.obsrv.pickerReady()
    return () => {
      el.removeEventListener('input', onInput)
      el.removeEventListener('change', onChange)
      el.removeEventListener('cancel', onCancel)
      el.removeEventListener('click', onClick)
    }
  }, [request])

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request])

  if (!request) return null
  const a = request.anchor
  return (
    <div className="menu-backdrop" onMouseDown={close}>
      <input
        ref={inputRef}
        className="picker-host"
        type={request.type}
        defaultValue={request.value}
        min={request.min || undefined}
        max={request.max || undefined}
        step={request.step || undefined}
        aria-label={request.ariaLabel}
        data-tab={request.tabId}
        data-picker-id={request.id}
        style={{ left: a.x, top: a.y, width: Math.max(1, a.width), height: Math.max(1, a.height) }}
        onMouseDown={e => e.stopPropagation()}
      />
    </div>
  )
}
