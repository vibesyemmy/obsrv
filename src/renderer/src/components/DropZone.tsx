import { useCallback, useEffect, useRef, useState } from 'react'
import { isSupported } from '../image/loadImage'
import { useStore } from '../state/store'

const SCALES = [1, 2, 3] as const
/** Spec §7: 2x is what design tools export by default, so it is the default here. */
const DEFAULT_SCALE = 2

/** `invoke` rejections arrive wrapped; the part after the prefix is main's own message. */
function ipcMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export interface DropZoneProps {
  onImage: (file: File, exportScale: number) => void
}

/**
 * Accepts image drops, File → Open Image… and exports dropped on the native
 * pane (main refuses that navigation and hands the path over), then asks
 * what scale the file was exported at.
 *
 * The prompt is a strip in normal document flow rather than a centred modal:
 * the native `WebContentsView` paints above the page, so an overlay covering
 * the left pane would end up behind it. A strip pushes the panes down instead,
 * and `NativeSlot` reports the new bounds. The drag hint, by contrast, is a
 * fixed badge over the right pane: anything that moved layout mid-drag would
 * fire dragleave/dragenter under the pointer and flicker.
 */
export function DropZone({ onImage }: DropZoneProps) {
  const [dragging, setDragging] = useState(false)
  const [pending, setPending] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const setToast = useStore(s => s.setToast)

  const accept = useCallback(
    (file: File | undefined): void => {
      if (!file) return
      if (!isSupported(file)) {
        setToast('Unsupported file type')
        return
      }
      setPending(file)
    },
    [setToast],
  )

  useEffect(() => {
    // dragenter/dragleave fire for every element the pointer crosses; only
    // the outermost balance (depth back to 0) means the drag left the window.
    let depth = 0
    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault()
      depth++
      setDragging(true)
    }
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    const onDragLeave = (): void => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const reset = (): void => {
      depth = 0
      setDragging(false)
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      reset()
      accept(e.dataTransfer?.files?.[0])
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('dragend', reset)
    window.addEventListener('drop', onDrop)
    const offOpen = window.obsrv.onOpenImage(() => inputRef.current?.click())
    const offPath = window.obsrv.onOpenImagePath(path => {
      const name = path.slice(path.lastIndexOf('/') + 1)
      const type = /\.png$/i.test(name) ? 'image/png' : 'image/jpeg'
      window.obsrv.readImageFile(path).then(
        // `slice()` lands the bytes on a plain ArrayBuffer, which is what the
        // File constructor's typing wants (IPC may deliver a shared one).
        bytes => accept(new File([bytes.slice().buffer], name, { type })),
        e => setToast(ipcMessage(e)),
      )
    })

    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('dragend', reset)
      window.removeEventListener('drop', onDrop)
      offOpen()
      offPath()
    }
  }, [accept, setToast])

  const confirm = useCallback(
    (scale: number): void => {
      if (!pending) return
      const file = pending
      setPending(null)
      onImage(file, scale)
    },
    [pending, onImage],
  )

  // The default button takes the focus when the prompt appears, so Enter
  // confirms 2x wherever the pointer was. Enter is left alone inside the
  // strip (a focused 1× or Cancel means that) and in a text field (the URL
  // bar's Enter is a navigation); Escape cancels from anywhere.
  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target instanceof Element ? e.target : null
      if (e.key === 'Escape') {
        e.preventDefault()
        setPending(null)
      } else if (e.key === 'Enter') {
        if (target?.closest('.scale-prompt') || target?.matches('input, textarea, select')) return
        e.preventDefault()
        confirm(DEFAULT_SCALE)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, confirm])

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg"
        hidden
        onChange={e => {
          accept(e.target.files?.[0])
          e.target.value = ''
        }}
      />

      {dragging && !pending && (
        <div className="drop-hint" role="status">
          Drop a PNG or JPG to see it at 1×
        </div>
      )}

      {pending && (
        <div className="strip scale-prompt">
          <span>
            <b>{pending.name}</b> — what scale was this exported at?
          </span>
          {SCALES.map(s => (
            <button
              key={s}
              type="button"
              className={`scale-${s}x`}
              aria-pressed={s === DEFAULT_SCALE}
              autoFocus={s === DEFAULT_SCALE}
              title={s === DEFAULT_SCALE ? 'Default — Enter' : undefined}
              onClick={() => confirm(s)}
            >
              {s}×
            </button>
          ))}
          <button type="button" className="scale-cancel" title="Escape" onClick={() => setPending(null)}>
            Cancel
          </button>
          <span className="muted">
            Geometry and colour are exact; type is approximate — export at 1× for that.
          </span>
        </div>
      )}
    </>
  )
}
